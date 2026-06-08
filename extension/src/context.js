import { ensureHostPermissions, getOriginPattern } from "./permissions.js";

export async function getActivePageTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    throw new Error("No active tab is available.");
  }

  return tab;
}

export function getPageOriginPattern(tab) {
  return getOriginPattern(tab?.url);
}

export async function ensurePageHostPermission(tab) {
  const originPattern = getPageOriginPattern(tab);

  if (!originPattern) {
    return true;
  }

  return ensureHostPermissions(
    [originPattern],
    "Latia needs access to this page before it can read the selected text or page content."
  );
}

export async function capturePageContext(maxChars = 80000, tabId = null) {
  const tab = tabId ? { id: tabId } : await getActivePageTab();

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (limit) => {
      const normalize = (value) =>
        String(value ?? "")
          .replace(/\n{3,}/g, "\n\n")
          .replace(/[ \t]{2,}/g, " ")
          .trim();

      const selectedText = normalize(window.getSelection?.().toString());
      const pageText = normalize(document.body?.innerText).slice(0, limit);
      const chosenText = selectedText || pageText;
      const source = selectedText ? "selection" : "page";

      return {
        source,
        title: document.title || location.hostname,
        url: location.href,
        capturedAt: new Date().toISOString(),
        text: chosenText.slice(0, limit),
        charCount: chosenText.slice(0, limit).length,
        truncated: chosenText.length > limit
      };
    },
    args: [maxChars]
  });

  if (!result?.text) {
    throw new Error("Could not read this page. Try selecting text manually.");
  }

  return result;
}
