import { capturePageContext, getActivePageTab, getPageOriginPattern } from "./context.js";
import { icons } from "./icons.js";
import { requestHostPermissions } from "./permissions.js";
import { getProviderOriginPattern, sendProviderRequest, testProvider } from "./providers.js";
import { createProvider, loadSettings, saveSettings } from "./storage.js";

const app = document.querySelector("#app");

let state = {
  settings: null,
  view: "chat",
  draft: "",
  busy: false,
  status: ""
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

  state.settings = settings;
  document.body.dataset.theme = settings.ui.theme;
  render();
}

function render() {
  const provider = getActiveProvider();
  app.innerHTML = `
    <section class="panel">
      ${renderHeader(provider)}
      ${state.view === "settings" ? renderSettings(provider) : renderChat(provider)}
    </section>
  `;

  bindHeader();

  if (state.view === "settings") {
    bindSettings();
  } else {
    bindChat();
  }
}

function renderHeader(provider) {
  const theme = state.settings.ui.theme;
  const nextTheme = theme === "dark" ? "light" : "dark";

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
        <button class="icon-button" id="themeButton" type="button" aria-label="Switch to ${nextTheme} mode">
          ${theme === "dark" ? icons.sun : icons.moon}
        </button>
        <button class="icon-button" id="settingsButton" type="button" aria-label="Settings">
          ${icons.settings}
        </button>
      </div>
    </header>
  `;
}

function renderChat(provider) {
  return `
    <main class="chat-view">
      <div class="messages" id="messages">
        ${state.settings.messages.map(renderMessage).join("")}
        ${state.busy ? `<article class="message assistant"><p>Thinking...</p></article>` : ""}
        <div class="privacy-notice">
          <span>Nothing is sent until you press Send.</span>
          <strong>Privacy</strong>
        </div>
      </div>

      <footer class="composer-wrap">
        <form class="composer" id="composer">
          <input
            id="questionInput"
            autocomplete="off"
            placeholder="${provider ? "Ask about this page..." : "Configure a provider first..."}"
            value="${escapeAttr(state.draft)}"
            ${state.busy ? "disabled" : ""}
          />
          <button class="send-button" type="submit" aria-label="Send" ${state.busy || !provider ? "disabled" : ""}>
            ${icons.send}
          </button>
        </form>
        ${state.status ? `<div class="status-line">${escapeHtml(state.status)}</div>` : ""}
      </footer>
    </main>
  `;
}

function renderMessage(message) {
  const context = message.snapshot
    ? `<div class="context-chip">
        <span>Used context</span>
        ${escapeHtml(formatContext(message.snapshot))}
      </div>`
    : "";

  return `
    <article class="message ${message.role}">
      <p>${escapeHtml(message.content)}</p>
      ${context}
    </article>
  `;
}

function renderSettings(provider) {
  return `
    <main class="settings-view">
      <form id="settingsForm" class="settings-form">
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
    await saveSettings(state.settings);
    render();
  });

  document.querySelector("#themeButton")?.addEventListener("click", async () => {
    state.settings.ui.theme = state.settings.ui.theme === "dark" ? "light" : "dark";
    document.body.dataset.theme = state.settings.ui.theme;
    await saveSettings(state.settings);
    render();
  });

  document.querySelector("#settingsButton")?.addEventListener("click", () => {
    state.view = state.view === "settings" ? "chat" : "settings";
    state.status = "";
    render();
  });
}

function bindChat() {
  const input = document.querySelector("#questionInput");
  const form = document.querySelector("#composer");

  input?.addEventListener("input", (event) => {
    state.draft = event.target.value;
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = state.draft.trim();
    const provider = getActiveProvider();

    if (!question || !provider || state.busy) return;

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

    state.busy = true;
    state.status = "";
    state.draft = "";
    state.settings.messages.push({ role: "user", content: question });
    await persistMessages();
    render();

    try {
      const snapshot = await capturePageContext(state.settings.context.maxChars, tab.id);
      const answer = await sendProviderRequest({ provider, snapshot, question });
      state.settings.messages.push({ role: "assistant", content: answer, snapshot });
      await persistMessages();
    } catch (error) {
      state.status = error.message;
    } finally {
      state.busy = false;
      render();
    }
  });
}

function bindSettings() {
  const form = document.querySelector("#settingsForm");
  const preset = document.querySelector("#preset");
  const testButton = document.querySelector("#testButton");

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

function applyPreset(name) {
  const baseUrl = document.querySelector("#baseUrl");
  const providerName = document.querySelector("#providerName");
  const model = document.querySelector("#model");
  const apiStyle = document.querySelector("#apiStyle");

  if (name === "Local OpenAI-Compatible") {
    providerName.value = "Local Server";
    baseUrl.value = "http://127.0.0.1:8787/v1";
    model.value = model.value || "local-model";
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

function getActiveProvider() {
  return (
    state.settings?.providers.find((provider) => provider.id === state.settings.defaultProviderId) ??
    state.settings?.providers.find((provider) => provider.isDefault) ??
    state.settings?.providers[0] ??
    null
  );
}

function formatContext(snapshot) {
  const mode = snapshot.source === "selection" ? "Selected text" : "Full page";
  const count = new Intl.NumberFormat().format(snapshot.charCount);
  return `${mode} / ${count} characters`;
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
