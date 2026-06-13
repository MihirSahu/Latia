const STORAGE_KEY = "latiaSettings";
const THREADS_KEY = "latiaThreads";

const defaultSettings = {
  providers: [],
  defaultProviderId: null,
  context: {
    maxChars: 80000
  },
  chat: {
    rememberThread: true,
    currentThreadId: null
  },
  privacy: {
    requireSendConfirmation: false,
    storeChatHistory: true
  },
  ui: {
    theme: "dark"
  },
  messages: []
};

export async function loadSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return mergeSettings(defaultSettings, stored[STORAGE_KEY] ?? {});
}

export async function saveSettings(settings) {
  const value =
    settings.privacy?.storeChatHistory === false
      ? {
          ...settings,
          chat: {
            ...settings.chat,
            currentThreadId: null
          },
          messages: []
        }
      : {
          ...settings,
          messages: sanitizeMessages(settings.messages)
        };

  await chrome.storage.local.set({ [STORAGE_KEY]: value });
  return value;
}

export async function loadThreads() {
  const stored = await chrome.storage.local.get(THREADS_KEY);
  const threads = Array.isArray(stored[THREADS_KEY]) ? stored[THREADS_KEY] : [];
  return threads.map(sanitizeThread).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export async function saveThreads(threads) {
  const value = threads.map(sanitizeThread).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  await chrome.storage.local.set({ [THREADS_KEY]: value });
  return value;
}

export async function clearThreads() {
  await chrome.storage.local.set({ [THREADS_KEY]: [] });
  return [];
}

export async function upsertThread(thread) {
  const threads = await loadThreads();
  const sanitizedThread = sanitizeThread(thread);
  const nextThreads = [sanitizedThread, ...threads.filter((item) => item.id !== sanitizedThread.id)];
  return saveThreads(nextThreads);
}

export async function deleteThread(threadId) {
  const threads = await loadThreads();
  return saveThreads(threads.filter((thread) => thread.id !== threadId));
}

export function createProvider(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    name: "Local Server",
    baseUrl: "http://127.0.0.1:3000/v1",
    apiKey: "",
    model: "",
    apiStyle: "chat_completions",
    enabled: true,
    isDefault: true,
    headers: {},
    ...overrides
  };
}

function mergeSettings(base, value) {
  return {
    ...base,
    ...value,
    context: { ...base.context, ...(value.context ?? {}) },
    chat: { ...base.chat, ...(value.chat ?? {}) },
    privacy: { ...base.privacy, ...(value.privacy ?? {}) },
    ui: { ...base.ui, ...(value.ui ?? {}) },
    providers: Array.isArray(value.providers) ? value.providers : base.providers,
    messages: Array.isArray(value.messages) ? value.messages : base.messages
  };
}

function sanitizeThread(thread) {
  const createdAt = thread.createdAt ?? new Date().toISOString();

  return {
    id: thread.id ?? crypto.randomUUID(),
    title: String(thread.title ?? "Untitled chat"),
    createdAt,
    updatedAt: thread.updatedAt ?? createdAt,
    providerId: thread.providerId ?? null,
    page: sanitizePage(thread.page),
    messages: sanitizeMessages(thread.messages)
  };
}

function sanitizePage(page = null) {
  if (!page) {
    return null;
  }

  return {
    title: page.title ?? "",
    url: page.url ?? "",
    origin: page.origin ?? getOrigin(page.url)
  };
}

function sanitizeMessages(messages = []) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.map((message) => ({
    id: message.id ?? crypto.randomUUID(),
    role: message.role === "assistant" ? "assistant" : "user",
    content: String(message.content ?? ""),
    createdAt: message.createdAt ?? new Date().toISOString(),
    snapshot: sanitizeSnapshot(message.snapshot)
  }));
}

function sanitizeSnapshot(snapshot = null) {
  if (!snapshot) {
    return null;
  }

  return {
    source: snapshot.source ?? "page",
    title: snapshot.title ?? "",
    url: snapshot.url ?? "",
    capturedAt: snapshot.capturedAt ?? "",
    charCount: snapshot.charCount ?? 0,
    truncated: Boolean(snapshot.truncated)
  };
}

function getOrigin(urlValue) {
  try {
    return new URL(urlValue).origin;
  } catch {
    return "";
  }
}
