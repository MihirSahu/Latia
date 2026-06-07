# Latia

Latia is a provider-neutral Chrome/Dia side-panel extension for asking questions about the current browser context.

## Load Locally

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select the `extension/` folder in this repo.

## MVP Behavior

- If text is selected on the page, Latia uses the selected text.
- If nothing is selected, Latia uses the full page text.
- Page content is only captured when you press Send.
- Provider settings are stored in `chrome.storage.local`.
- Any OpenAI-compatible `/v1/chat/completions` or `/v1/responses` endpoint can be configured.
