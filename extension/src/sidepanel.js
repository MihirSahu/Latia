import { capturePageContext, getActivePageTab, getPageOriginPattern } from "./context.js";
import { icons } from "./icons.js";
import { requestHostPermissions } from "./permissions.js";
import { getProviderOriginPattern, sendProviderRequest, testProvider } from "./providers.js";
import { clearThreads, createProvider, deleteThread, loadSettings, loadThreads, saveSettings, upsertThread } from "./storage.js";

const app = document.querySelector("#app");

const PROMPT_PRESETS = [
  {
    command: "/summarize",
    label: "Summarize",
    prompt: "Summarize the current context with the main points and any important caveats."
  },
  {
    command: "/extract",
    label: "Extract",
    prompt: "Extract the most important facts, names, dates, and decisions from the current context."
  },
  {
    command: "/rewrite",
    label: "Rewrite",
    prompt: "Rewrite the selected text to be clearer and more concise while preserving the meaning."
  },
  {
    command: "/questions",
    label: "Questions",
    prompt: "List the most useful follow-up questions to ask about this context."
  }
];

let shortcutsBound = false;
let contextListenersBound = false;

let state = {
  settings: null,
  view: "chat",
  draft: "",
  busy: false,
  status: "",
  contextPreview: null,
  copiedMessageId: null,
  threads: []
};

init();

async function init() {
  const settings = await loadSettings();

  if (!settings.providers.length) {
    const provider = createProvider();
    settings.providers = [provider];
    settings.defaultProviderId = provider.id;
    await saveSettings(settings);
  }

  state.settings = normalizeLoadedSettings(settings);
  state.threads = state.settings.privacy.storeChatHistory ? await loadThreads() : await clearThreads();
  restoreCurrentThread();
  document.body.dataset.theme = state.settings.ui.theme;
  bindShortcuts();
  bindContextInvalidation();
  render();
}

function render() {
  const provider = getActiveProvider();
  app.innerHTML = `
    <section class="panel">
      ${renderHeader(provider)}
      ${renderMainView(provider)}
    </section>
  `;

  bindHeader();

  if (state.view === "settings") {
    bindSettings();
  } else if (state.view === "history") {
    bindHistory();
  } else {
    bindChat();
  }
}

function renderMainView(provider) {
  if (state.view === "settings") {
    return renderSettings(provider);
  }

  if (state.view === "history") {
    return renderHistory();
  }

  return renderChat(provider);
}

function renderHeader(provider) {
  const theme = state.settings.ui.theme;
  const nextTheme = theme === "dark" ? "light" : "dark";
  const hasMessages = state.settings.messages.length > 0;

  return `
    <header class="topbar">
      <label class="model-select" aria-label="Model">
        <span class="model-mark">L</span>
        <select id="providerSelect">
          ${state.settings.providers
            .map(
              (item) =>
                `<option value="${escapeAttr(item.id)}" ${item.id === provider?.id ? "selected" : ""}>
                  ${escapeHtml(item.model || item.name || "Configure provider")}
                </option>`
            )
            .join("")}
        </select>
      </label>

      <div class="top-actions">
        <button class="icon-button" id="newChatButton" type="button" aria-label="New chat" ${hasMessages ? "" : "disabled"}>
          ${icons.plus}
        </button>
        <button class="icon-button ${state.view === "chat" ? "is-active" : ""}" id="chatButton" type="button" aria-label="Chat">
          ${icons.chat}
        </button>
        <button class="icon-button ${state.view === "history" ? "is-active" : ""}" id="historyButton" type="button" aria-label="History">
          ${icons.history}
        </button>
        <button class="icon-button" id="themeButton" type="button" aria-label="Switch to ${nextTheme} mode">
          ${theme === "dark" ? icons.sun : icons.moon}
        </button>
        <button class="icon-button ${state.view === "settings" ? "is-active" : ""}" id="settingsButton" type="button" aria-label="Settings">
          ${icons.settings}
        </button>
      </div>
    </header>
  `;
}

function renderHistory() {
  return `
    <main class="history-view">
      ${state.threads.length ? state.threads.map(renderThreadRow).join("") : renderEmptyHistory()}
    </main>
  `;
}

function renderThreadRow(thread) {
  const active = thread.id === state.settings.chat.currentThreadId;
  const count = formatNumber(thread.messages.length);
  const pageLabel = thread.page?.title || thread.page?.origin || "Saved chat";

  return `
    <article class="thread-row ${active ? "is-active" : ""}">
      <button class="thread-open" type="button" data-thread-open="${escapeAttr(thread.id)}">
        <strong>${escapeHtml(thread.title || "Untitled chat")}</strong>
        <span>${escapeHtml(pageLabel)} / ${count} messages</span>
        <small>${escapeHtml(formatRelativeDate(thread.updatedAt))}</small>
      </button>
      <button class="message-action thread-delete" type="button" data-thread-delete="${escapeAttr(thread.id)}" aria-label="Delete chat">
        ${icons.trash}
      </button>
    </article>
  `;
}

function renderEmptyHistory() {
  return `
    <div class="empty-history">
      <strong>No saved chats yet</strong>
      <span>Chats are stored locally after the first assistant response.</span>
    </div>
  `;
}

function renderChat(provider) {
  return `
    <main class="chat-view">
      <div class="messages" id="messages">
        ${state.settings.messages.map(renderMessage).join("")}
        ${renderPrivacyNotice()}
      </div>

      <footer class="composer-wrap">
        ${renderPromptMenu()}
        ${renderContextPreview()}
        <form class="composer" id="composer">
          <textarea
            id="questionInput"
            autocomplete="off"
            rows="1"
            placeholder="${provider ? "Ask about this page..." : "Configure a provider first..."}"
            ${state.busy ? "disabled" : ""}
          >${escapeHtml(state.draft)}</textarea>
          <button class="send-button" type="submit" aria-label="Send" ${state.busy || !provider ? "disabled" : ""}>
            ${icons.send}
          </button>
        </form>
        ${state.status ? `<div class="status-line">${escapeHtml(state.status)}</div>` : ""}
      </footer>
    </main>
  `;
}

function renderPrivacyNotice() {
  if (state.settings.messages.length) {
    return "";
  }

  return `
    <div class="privacy-notice">
      <span>Nothing is sent until you press Send.</span>
      <strong>Privacy</strong>
    </div>
  `;
}

function renderMessage(message, index) {
  const context = message.snapshot
    ? `<details class="context-chip">
        <summary>
          <span>Used context</span>
          ${escapeHtml(formatContext(message.snapshot))}
        </summary>
        <div>${escapeHtml(formatContextDetails(message.snapshot))}</div>
      </details>`
    : "";
  const canRegenerate = Boolean(message.snapshot?.text);
  const actions =
    message.role === "assistant"
      ? `<div class="message-actions">
          <button class="message-action" type="button" data-action="copy" data-index="${index}" aria-label="Copy answer">
            ${state.copiedMessageId === message.id ? icons.check : icons.copy}
          </button>
          ${
            canRegenerate
              ? `<button class="message-action" type="button" data-action="regenerate" data-index="${index}" aria-label="Regenerate response" ${state.busy ? "disabled" : ""}>
                  ${icons.refresh}
                </button>`
              : ""
          }
        </div>`
      : "";

  return `
    <article class="message ${message.role} ${message.streaming ? "is-streaming" : ""}" data-message-id="${escapeAttr(message.id)}">
      ${actions}
      <p id="message-content-${escapeAttr(message.id)}">${escapeHtml(message.content || (message.streaming ? "Thinking..." : ""))}</p>
      ${context}
    </article>
  `;
}

function renderPromptMenu() {
  const query = state.draft.trimStart();

  const options = getPromptOptions(query);

  if (!options.length) {
    return "";
  }

  return `
    <div class="prompt-menu" role="listbox" aria-label="Prompt presets">
      ${options
        .map(
          (preset) => `
            <button type="button" data-preset="${escapeAttr(preset.command)}">
              <span>${escapeHtml(preset.command)}</span>
              ${escapeHtml(preset.label)}
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderContextPreview() {
  const preview = state.contextPreview;
  const title = preview?.title ?? "Context";
  const detail = preview?.detail ?? "Selection if present, otherwise full page";
  const memoryLabel = state.settings.chat.rememberThread ? "Memory on" : "Memory off";

  return `
    <div class="context-preview">
      <div>
        <span>${escapeHtml(title)}</span>
        <strong>${escapeHtml(detail)}</strong>
      </div>
      <button class="memory-toggle ${state.settings.chat.rememberThread ? "is-on" : ""}" id="memoryToggle" type="button" aria-label="Toggle thread memory">
        ${icons.database}
        <span>${memoryLabel}</span>
      </button>
    </div>
  `;
}

function syncContextPreview() {
  const title = document.querySelector(".context-preview > div span");
  const detail = document.querySelector(".context-preview strong");

  if (title) {
    title.textContent = state.contextPreview?.title ?? "Context";
  }

  if (detail) {
    detail.textContent = state.contextPreview?.detail ?? "Selection if present, otherwise full page";
  }
}

function renderSettings(provider) {
  return `
    <main class="settings-view">
      <form id="settingsForm" class="settings-form">
        <div class="profile-row">
          <label class="field">
            <span>Provider profile</span>
            <select id="settingsProviderSelect">
              ${state.settings.providers
                .map(
                  (item) =>
                    `<option value="${escapeAttr(item.id)}" ${item.id === provider?.id ? "selected" : ""}>
                      ${escapeHtml(item.name || item.model || "Provider")}
                    </option>`
                )
                .join("")}
            </select>
          </label>
          <button class="icon-button" id="addProviderButton" type="button" aria-label="Add provider">
            ${icons.plus}
          </button>
          <button class="icon-button danger-icon" id="deleteProviderButton" type="button" aria-label="Delete provider" ${state.settings.providers.length <= 1 ? "disabled" : ""}>
            ${icons.trash}
          </button>
        </div>

        <label class="field">
          <span>Preset</span>
          <select id="preset">
            <option>Local OpenAI-Compatible</option>
            <option>OpenAI-compatible HTTPS</option>
            <option>Custom</option>
          </select>
        </label>

        <label class="field">
          <span>Provider name</span>
          <input id="providerName" value="${escapeAttr(provider?.name ?? "")}" />
        </label>

        <label class="field">
          <span>Base URL</span>
          <input id="baseUrl" value="${escapeAttr(provider?.baseUrl ?? "")}" />
        </label>

        <div class="field-grid">
          <label class="field">
            <span>API key</span>
            <input id="apiKey" type="password" value="${escapeAttr(provider?.apiKey ?? "")}" />
          </label>

          <label class="field">
            <span>API style</span>
            <select id="apiStyle">
              <option value="chat_completions" ${provider?.apiStyle === "chat_completions" ? "selected" : ""}>Chat</option>
              <option value="responses" ${provider?.apiStyle === "responses" ? "selected" : ""}>Responses</option>
            </select>
          </label>
        </div>

        <label class="field">
          <span>Model</span>
          <input id="model" value="${escapeAttr(provider?.model ?? "")}" />
        </label>

        <div class="connection-state ${state.status.includes("verified") ? "is-ok" : ""}">
          <div>
            <strong>${escapeHtml(state.status || "Connection not tested")}</strong>
            <small>${escapeHtml(provider?.apiStyle === "responses" ? "Responses API selected." : "Chat Completions selected.")}</small>
          </div>
          <span></span>
        </div>

        <label class="check-row">
          <input id="requireConfirmation" type="checkbox" ${state.settings.privacy.requireSendConfirmation ? "checked" : ""} />
          <span>Require confirmation before sending page content</span>
        </label>

        <label class="check-row">
          <input id="rememberThread" type="checkbox" ${state.settings.chat.rememberThread ? "checked" : ""} />
          <span>Remember previous turns in this chat</span>
        </label>

        <div class="settings-actions">
          <button class="secondary-button" id="testButton" type="button">Test connection</button>
          <button class="primary-button" type="submit">Save</button>
        </div>
      </form>
    </main>
  `;
}

function bindHeader() {
  document.querySelector("#providerSelect")?.addEventListener("change", async (event) => {
    state.settings.defaultProviderId = event.target.value;
    state.contextPreview = null;
    await saveSettings(state.settings);
    render();
  });

  document.querySelector("#newChatButton")?.addEventListener("click", async () => {
    await clearThread();
  });

  document.querySelector("#chatButton")?.addEventListener("click", () => {
    if (state.view === "chat") {
      return;
    }

    state.view = "chat";
    state.status = "";
    render();
  });

  document.querySelector("#historyButton")?.addEventListener("click", () => {
    if (state.view === "history") {
      return;
    }

    state.view = "history";
    state.status = "";
    render();
  });

  document.querySelector("#themeButton")?.addEventListener("click", async () => {
    state.settings.ui.theme = state.settings.ui.theme === "dark" ? "light" : "dark";
    document.body.dataset.theme = state.settings.ui.theme;
    await saveSettings(state.settings);
    render();
  });

  document.querySelector("#settingsButton")?.addEventListener("click", () => {
    if (state.view === "settings") {
      return;
    }

    state.view = "settings";
    state.status = "";
    render();
  });
}

function bindChat() {
  const input = document.querySelector("#questionInput");
  const form = document.querySelector("#composer");
  const composerWrap = document.querySelector(".composer-wrap");

  autoSizeTextarea(input);
  void refreshContextPreview();

  input?.addEventListener("input", (event) => {
    const hadPromptMenu = getPromptOptions(state.draft.trimStart()).length > 0;
    state.draft = event.target.value;
    const hasPromptMenu = getPromptOptions(state.draft.trimStart()).length > 0;

    autoSizeTextarea(input);

    if (hadPromptMenu || hasPromptMenu) {
      render();
      document.querySelector("#questionInput")?.focus();
    }
  });

  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form?.requestSubmit();
    }
  });

  input?.addEventListener("focus", () => {
    void refreshContextPreview({ force: true });
  });

  input?.addEventListener("click", () => {
    void refreshContextPreview({ force: true });
  });

  composerWrap?.addEventListener("pointerenter", () => {
    void refreshContextPreview({ force: true });
  });

  document.querySelector("#memoryToggle")?.addEventListener("click", async () => {
    state.settings.chat.rememberThread = !state.settings.chat.rememberThread;
    await saveSettings(state.settings);
    render();
  });

  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const preset = PROMPT_PRESETS.find((item) => item.command === button.dataset.preset);

      if (!preset) {
        return;
      }

      state.draft = preset.prompt;
      render();
      document.querySelector("#questionInput")?.focus();
    });
  });

  document.querySelector("#messages")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");

    if (!button) {
      return;
    }

    const index = Number(button.dataset.index);

    if (button.dataset.action === "copy") {
      await copyMessage(index);
    }

    if (button.dataset.action === "regenerate") {
      await regenerateMessage(index);
    }
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitQuestion();
  });
}

function bindHistory() {
  document.querySelector(".history-view")?.addEventListener("click", async (event) => {
    const openButton = event.target.closest("[data-thread-open]");
    const deleteButton = event.target.closest("[data-thread-delete]");

    if (deleteButton) {
      event.preventDefault();
      event.stopPropagation();
      await removeSavedThread(deleteButton.dataset.threadDelete);
      return;
    }

    if (openButton) {
      await openSavedThread(openButton.dataset.threadOpen);
    }
  });
}

function bindSettings() {
  const form = document.querySelector("#settingsForm");
  const preset = document.querySelector("#preset");
  const providerSelect = document.querySelector("#settingsProviderSelect");
  const addProviderButton = document.querySelector("#addProviderButton");
  const deleteProviderButton = document.querySelector("#deleteProviderButton");
  const testButton = document.querySelector("#testButton");

  providerSelect?.addEventListener("change", async (event) => {
    state.settings.defaultProviderId = event.target.value;
    state.status = "";
    await saveSettings(state.settings);
    render();
  });

  addProviderButton?.addEventListener("click", async () => {
    const provider = createProvider({
      name: `Provider ${state.settings.providers.length + 1}`,
      isDefault: true
    });

    state.settings.providers = state.settings.providers.map((item) => ({ ...item, isDefault: false }));
    state.settings.providers.push(provider);
    state.settings.defaultProviderId = provider.id;
    state.status = "Provider added";
    await saveSettings(state.settings);
    render();
  });

  deleteProviderButton?.addEventListener("click", async () => {
    const provider = getActiveProvider();

    if (!provider || state.settings.providers.length <= 1) {
      return;
    }

    state.settings.providers = state.settings.providers.filter((item) => item.id !== provider.id);
    state.settings.defaultProviderId = state.settings.providers[0]?.id ?? null;
    state.settings.providers = state.settings.providers.map((item, index) => ({
      ...item,
      isDefault: index === 0
    }));
    state.status = "Provider deleted";
    await saveSettings(state.settings);
    render();
  });

  preset?.addEventListener("change", (event) => {
    applyPreset(event.target.value);
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    updateProviderFromForm();
    state.status = "Settings saved";
    await saveSettings(state.settings);
    render();
  });

  testButton?.addEventListener("click", async () => {
    updateProviderFromForm();

    try {
      await requestHostPermissions(
        [getProviderOriginPattern(getActiveProvider())],
        "Latia needs access to the provider origin before it can send requests."
      );
    } catch (error) {
      state.status = error.message;
      render();
      return;
    }

    state.status = "Testing connection...";
    render();

    try {
      await testProvider(getActiveProvider());
      state.status = "Connection verified";
    } catch (error) {
      state.status = error.message;
    }

    await saveSettings(state.settings);
    render();
  });
}

async function submitQuestion() {
  const question = state.draft.trim();
  const provider = getActiveProvider();

  if (!question || !provider || state.busy) {
    return;
  }

  if (state.settings.privacy.requireSendConfirmation) {
    const ok = confirm("Send the current page context with your question?");
    if (!ok) return;
  }

  let tab;

  try {
    tab = await getActivePageTab();
    await requestHostPermissions(
      [getProviderOriginPattern(provider), getPageOriginPattern(tab)],
      "Latia needs access to this page and provider before it can answer."
    );
  } catch (error) {
    state.status = error.message;
    render();
    return;
  }

  const conversation = getConversationForRequest();
  state.busy = true;
  state.status = "Reading context...";
  state.draft = "";
  render();

  let assistantMessage = null;

  try {
    const snapshot = await capturePageContext(state.settings.context.maxChars, tab.id);
    state.contextPreview = {
      ...previewFromSnapshot(snapshot),
      checkedAt: Date.now(),
      key: getContextPreviewKey(tab)
    };

    const userMessage = createMessage("user", question);
    assistantMessage = createMessage("assistant", "", { snapshot, streaming: true });
    ensureCurrentThread({ provider, snapshot, question });

    state.settings.messages.push(userMessage, assistantMessage);
    state.status = "";
    render();

    await streamAnswer({
      provider,
      snapshot,
      question,
      conversation,
      message: assistantMessage
    });
  } catch (error) {
    if (assistantMessage && !assistantMessage.content) {
      state.settings.messages = state.settings.messages.filter((message) => message.id !== assistantMessage.id);
    }

    state.status = error.message;
  } finally {
    state.busy = false;
    clearStreamingFlags();
    await persistMessages();
    await persistCurrentThread();
    render();
  }
}

async function regenerateMessage(index) {
  if (state.busy) {
    return;
  }

  const assistantMessage = state.settings.messages[index];
  const userMessage = findPreviousUserMessage(index);
  const provider = getActiveProvider();

  if (!provider || !assistantMessage || !userMessage) {
    return;
  }

  try {
    await requestHostPermissions(
      [getProviderOriginPattern(provider)],
      "Latia needs access to the provider origin before it can send requests."
    );
  } catch (error) {
    state.status = error.message;
    render();
    return;
  }

  const snapshot = assistantMessage.snapshot;

  if (!snapshot?.text) {
    state.status = "This response does not have context to reuse.";
    render();
    return;
  }

  state.busy = true;
  state.status = "";
  const previousContent = assistantMessage.content;
  assistantMessage.content = "";
  assistantMessage.streaming = true;
  render();

  try {
    await streamAnswer({
      provider,
      snapshot,
      question: userMessage.content,
      conversation: getConversationForRequest(index - 1),
      message: assistantMessage
    });
  } catch (error) {
    if (!assistantMessage.content) {
      assistantMessage.content = previousContent;
    }

    state.status = error.message;
  } finally {
    state.busy = false;
    assistantMessage.streaming = false;
    await persistMessages();
    await persistCurrentThread();
    render();
  }
}

async function streamAnswer({ provider, snapshot, question, conversation, message }) {
  let answer;

  try {
    answer = await sendProviderRequest({
      provider,
      snapshot,
      question,
      conversation,
      stream: true,
      onToken: (_delta, text) => {
        message.content = text;
        updateMessageContent(message);
      }
    });
  } catch (error) {
    if (message.content) {
      throw error;
    }

    answer = await sendProviderRequest({
      provider,
      snapshot,
      question,
      conversation,
      stream: false
    });
  }

  message.content = answer;
  message.streaming = false;
}

async function copyMessage(index) {
  const message = state.settings.messages[index];

  if (!message?.content) {
    return;
  }

  await navigator.clipboard.writeText(message.content);
  state.copiedMessageId = message.id;
  render();
  setTimeout(() => {
    if (state.copiedMessageId === message.id) {
      state.copiedMessageId = null;
      render();
    }
  }, 1200);
}

async function clearThread() {
  state.settings.messages = [];
  state.settings.chat.currentThreadId = null;
  state.status = "New chat";
  await persistMessages();
  render();
}

async function refreshContextPreview({ force = false } = {}) {
  if (state.view !== "chat" || state.busy) {
    return;
  }

  if (!force && state.contextPreview?.checkedAt && Date.now() - state.contextPreview.checkedAt < 1500) {
    return;
  }

  try {
    const tab = await getActivePageTab();
    const previewKey = getContextPreviewKey(tab);

    if (!force && state.contextPreview?.key === previewKey && Date.now() - state.contextPreview.checkedAt < 5000) {
      return;
    }

    state.contextPreview = {
      checkedAt: Date.now(),
      key: previewKey,
      title: "Context",
      detail: "Selection if present, otherwise full page on Send"
    };

    const originPattern = getPageOriginPattern(tab);

    if (!originPattern) {
      state.contextPreview = {
        checkedAt: Date.now(),
        key: previewKey,
        title: "Context unavailable",
        detail: "This browser page cannot be read"
      };
      syncContextPreview();
      return;
    }

    syncContextPreview();
  } catch {
    state.contextPreview = {
      checkedAt: Date.now(),
      key: "unavailable",
      title: "Context unavailable",
      detail: "No active readable page"
    };
    syncContextPreview();
  }
}

function getContextPreviewKey(tab) {
  return `${tab?.id ?? "none"}:${tab?.url ?? ""}`;
}

function restoreCurrentThread() {
  if (!state.settings.privacy.storeChatHistory) {
    state.settings.chat.currentThreadId = null;
    state.settings.messages = [];
    return;
  }

  const thread = state.threads.find((item) => item.id === state.settings.chat.currentThreadId);

  if (!thread) {
    state.settings.chat.currentThreadId = null;
    return;
  }

  state.settings.messages = reviveMessages(thread.messages);
}

function ensureCurrentThread({ provider, snapshot, question }) {
  if (state.settings.chat.currentThreadId) {
    return;
  }

  state.settings.chat.currentThreadId = createId();
  state.threads = [
    {
      id: state.settings.chat.currentThreadId,
      title: makeThreadTitle(question),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      providerId: provider?.id ?? null,
      page: getThreadPage(snapshot),
      messages: []
    },
    ...state.threads
  ];
}

async function persistCurrentThread() {
  const threadId = state.settings.chat.currentThreadId;

  if (!state.settings.privacy.storeChatHistory) {
    state.threads = await clearThreads();
    state.settings.chat.currentThreadId = null;
    return;
  }

  if (!threadId || !state.settings.messages.length) {
    return;
  }

  const hasAssistantResponse = state.settings.messages.some(
    (message) => message.role === "assistant" && String(message.content ?? "").trim()
  );

  if (!hasAssistantResponse) {
    state.threads = state.threads.filter((thread) => thread.id !== threadId);
    return;
  }

  const existingThread = state.threads.find((thread) => thread.id === threadId);
  const provider = getActiveProvider();
  const latestSnapshot = findLatestSnapshot(state.settings.messages);
  const thread = {
    id: threadId,
    title: existingThread?.title ?? makeThreadTitle(state.settings.messages.find((message) => message.role === "user")?.content),
    createdAt: existingThread?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    providerId: existingThread?.providerId ?? provider?.id ?? null,
    page: existingThread?.page ?? getThreadPage(latestSnapshot),
    messages: state.settings.messages
  };

  state.threads = await upsertThread(thread);
}

async function openSavedThread(threadId) {
  const thread = state.threads.find((item) => item.id === threadId);

  if (!thread) {
    return;
  }

  state.settings.chat.currentThreadId = thread.id;
  state.settings.messages = reviveMessages(thread.messages);
  state.view = "chat";
  state.status = "";
  state.contextPreview = null;
  await saveSettings(state.settings);
  render();
}

async function removeSavedThread(threadId) {
  state.threads = await deleteThread(threadId);

  if (state.settings.chat.currentThreadId === threadId) {
    state.settings.chat.currentThreadId = null;
    state.settings.messages = [];
    await saveSettings(state.settings);
  }

  render();
}

function reviveMessages(messages = []) {
  return messages.map((message) => ({
    ...message,
    id: message.id ?? createId(),
    streaming: false
  }));
}

function findLatestSnapshot(messages) {
  return [...messages].reverse().find((message) => message.snapshot)?.snapshot ?? null;
}

function getThreadPage(snapshot) {
  if (!snapshot) {
    return null;
  }

  return {
    title: snapshot.title ?? "",
    url: snapshot.url ?? "",
    origin: getOrigin(snapshot.url)
  };
}

function makeThreadTitle(value = "") {
  const title = String(value).replace(/\s+/g, " ").trim();

  if (!title) {
    return "Untitled chat";
  }

  return title.length > 56 ? `${title.slice(0, 53)}...` : title;
}

function applyPreset(name) {
  const baseUrl = document.querySelector("#baseUrl");
  const providerName = document.querySelector("#providerName");
  const model = document.querySelector("#model");
  const apiStyle = document.querySelector("#apiStyle");

  if (name === "Local OpenAI-Compatible") {
    providerName.value = "Local Server";
    baseUrl.value = "http://127.0.0.1:3000/v1";
    model.value = "";
    apiStyle.value = "chat_completions";
  }

  if (name === "OpenAI-compatible HTTPS") {
    providerName.value = "Remote Provider";
    baseUrl.value = "https://example.com/v1";
    model.value = model.value || "model-name";
    apiStyle.value = "chat_completions";
  }
}

function updateProviderFromForm() {
  const provider = getActiveProvider() ?? createProvider();
  const existingIndex = state.settings.providers.findIndex((item) => item.id === provider.id);

  provider.name = document.querySelector("#providerName").value.trim() || "Provider";
  provider.baseUrl = document.querySelector("#baseUrl").value.trim();
  provider.apiKey = document.querySelector("#apiKey").value;
  provider.model = document.querySelector("#model").value.trim();
  provider.apiStyle = document.querySelector("#apiStyle").value;
  provider.isDefault = true;
  state.settings.privacy.requireSendConfirmation = document.querySelector("#requireConfirmation").checked;
  state.settings.chat.rememberThread = document.querySelector("#rememberThread").checked;

  state.settings.providers = state.settings.providers.map((item) => ({
    ...item,
    isDefault: item.id === provider.id
  }));

  if (existingIndex >= 0) {
    state.settings.providers[existingIndex] = provider;
  } else {
    state.settings.providers.push(provider);
  }

  state.settings.defaultProviderId = provider.id;
}

async function persistMessages() {
  if (!state.settings.privacy.storeChatHistory) {
    state.settings.messages = [];
  }

  await saveSettings(state.settings);
}

function bindContextInvalidation() {
  if (contextListenersBound) {
    return;
  }

  contextListenersBound = true;
  chrome.tabs?.onActivated?.addListener(() => {
    state.contextPreview = null;
    if (state.view === "chat") {
      render();
    }
  });
  chrome.tabs?.onUpdated?.addListener((_tabId, changeInfo) => {
    if (changeInfo.url || changeInfo.status === "complete") {
      state.contextPreview = null;
      if (state.view === "chat") {
        render();
      }
    }
  });
  chrome.windows?.onFocusChanged?.addListener(() => {
    state.contextPreview = null;
    if (state.view === "chat") {
      render();
    }
  });
}

function bindShortcuts() {
  if (shortcutsBound) {
    return;
  }

  shortcutsBound = true;
  document.addEventListener("keydown", (event) => {
    const input = document.querySelector("#questionInput");

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      document.querySelector("#providerSelect")?.focus();
      return;
    }

    if (event.key === "/" && state.view === "chat" && document.activeElement !== input) {
      event.preventDefault();
      state.draft = "/";
      render();
      document.querySelector("#questionInput")?.focus();
    }
  });
}

function getActiveProvider() {
  return (
    state.settings?.providers.find((provider) => provider.id === state.settings.defaultProviderId) ??
    state.settings?.providers.find((provider) => provider.isDefault) ??
    state.settings?.providers[0] ??
    null
  );
}

function getPromptOptions(query) {
  if (!query.startsWith("/") || state.busy) {
    return [];
  }

  return PROMPT_PRESETS.filter((preset) => preset.command.startsWith(query.toLowerCase()));
}

function getConversationForRequest(endIndex = state.settings.messages.length) {
  if (!state.settings.chat.rememberThread) {
    return [];
  }

  return state.settings.messages
    .slice(0, endIndex)
    .filter((message) => !message.streaming)
    .map((message) => ({
      role: message.role,
      content: message.content
    }));
}

function findPreviousUserMessage(index) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (state.settings.messages[cursor]?.role === "user") {
      return state.settings.messages[cursor];
    }
  }

  return null;
}

function updateMessageContent(message) {
  const element = document.querySelector(`#message-content-${CSS.escape(message.id)}`);

  if (element) {
    element.textContent = message.content || "Thinking...";
  }
}

function autoSizeTextarea(input) {
  if (!input) {
    return;
  }

  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 118)}px`;
}

function clearStreamingFlags() {
  state.settings.messages = state.settings.messages.map((message) => ({
    ...message,
    streaming: false
  }));
}

function normalizeLoadedSettings(settings) {
  return {
    ...settings,
    messages: settings.privacy.storeChatHistory
      ? settings.messages.map((message) => ({
          ...message,
          id: message.id ?? createId(),
          streaming: false
        }))
      : []
  };
}

function createMessage(role, content, extra = {}) {
  return {
    id: createId(),
    role,
    content,
    createdAt: new Date().toISOString(),
    ...extra
  };
}

function createId() {
  return crypto.randomUUID();
}

function previewFromSnapshot(snapshot) {
  return {
    title: snapshot.source === "selection" ? "Selected text" : "Full page",
    detail: `${formatNumber(snapshot.charCount)} characters${snapshot.truncated ? " / truncated" : ""}`
  };
}

function formatContext(snapshot) {
  const mode = snapshot.source === "selection" ? "Selected text" : "Full page";
  return `${mode} / ${formatNumber(snapshot.charCount)} characters`;
}

function formatContextDetails(snapshot) {
  const lines = [
    snapshot.title ? `Title: ${snapshot.title}` : "",
    snapshot.url ? `URL: ${snapshot.url}` : "",
    snapshot.capturedAt ? `Captured: ${new Date(snapshot.capturedAt).toLocaleString()}` : "",
    snapshot.truncated ? "Context was truncated to fit the character limit." : ""
  ].filter(Boolean);

  return lines.join("\n");
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value ?? 0);
}

function formatRelativeDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();

  return sameDay
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function getOrigin(urlValue) {
  try {
    return new URL(urlValue).origin;
  } catch {
    return "";
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("\n", " ");
}
