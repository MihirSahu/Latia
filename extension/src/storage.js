const STORAGE_KEY = "latiaSettings";

const defaultSettings = {
  providers: [],
  defaultProviderId: null,
  context: {
    maxChars: 80000
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
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
  return settings;
}

export function createProvider(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    name: "Local Server",
    baseUrl: "http://127.0.0.1:8787/v1",
    apiKey: "",
    model: "local-model",
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
    privacy: { ...base.privacy, ...(value.privacy ?? {}) },
    ui: { ...base.ui, ...(value.ui ?? {}) },
    providers: Array.isArray(value.providers) ? value.providers : base.providers,
    messages: Array.isArray(value.messages) ? value.messages : base.messages
  };
}
