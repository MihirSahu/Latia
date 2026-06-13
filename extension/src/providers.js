import { ensureHostPermissions, getOriginPattern } from "./permissions.js";

export async function sendProviderRequest({
  provider,
  snapshot,
  question,
  conversation = [],
  stream = false,
  onToken = null
}) {
  if (!provider) {
    throw new Error("No model provider configured.");
  }

  await ensureProviderHostPermission(provider);

  const baseUrl = provider.baseUrl.replace(/\/$/, "");
  const headers = {
    "Content-Type": "application/json",
    ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
    ...(provider.headers ?? {})
  };

  const systemPrompt = [
    "You are helping the user understand the current browser context.",
    "Use only the provided page context unless the user clearly asks for general knowledge.",
    "Do not claim to see parts of the page that are not included.",
    "If the context is insufficient, say what is missing.",
    "Be concise by default.",
    "When helpful, refer to the specific part of the context you used."
  ].join("\n");

  const promptMessages = buildPromptMessages({ snapshot, question, conversation });

  if (provider.apiStyle === "responses") {
    const response = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: provider.model,
        input: [{ role: "system", content: systemPrompt }, ...promptMessages],
        stream
      })
    });

    if (stream) {
      return readStreamingText(response, readResponsesStreamDelta, readResponsesText, onToken);
    }

    const json = await readJsonResponse(response);
    return readResponsesText(json);
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: provider.model,
      messages: [{ role: "system", content: systemPrompt }, ...promptMessages],
      stream
    })
  });

  if (stream) {
    return readStreamingText(response, readChatCompletionsStreamDelta, readChatCompletionsText, onToken);
  }

  const json = await readJsonResponse(response);
  return readChatCompletionsText(json);
}

export async function testProvider(provider) {
  if (!provider) {
    throw new Error("No model provider configured.");
  }

  await ensureProviderHostPermission(provider);

  const snapshot = {
    source: "selection",
    title: "Connection test",
    url: "",
    capturedAt: new Date().toISOString(),
    text: "Connection test.",
    charCount: 16
  };

  await sendProviderRequest({
    provider,
    snapshot,
    question: "Reply with OK.",
    stream: false
  });

  return true;
}

export async function ensureProviderHostPermission(provider) {
  const originPattern = getProviderOriginPattern(provider);

  if (!originPattern) {
    throw new Error("Enter a valid provider Base URL.");
  }

  return ensureHostPermissions(
    [originPattern],
    "Latia needs access to the provider origin before it can send requests."
  );
}

export function getProviderOriginPattern(provider) {
  return getOriginPattern(provider?.baseUrl);
}

async function readJsonResponse(response) {
  let json;

  try {
    json = await response.json();
  } catch {
    json = null;
  }

  if (!response.ok) {
    const message = json?.error?.message || json?.message || formatProviderError(response.status);
    throw new Error(message);
  }

  return json;
}

function buildPromptMessages({ snapshot, question, conversation }) {
  const userPrompt =
    snapshot.source === "selection"
      ? [
          "The user selected this text from the page:",
          "",
          snapshot.text,
          "",
          "Question:",
          question
        ].join("\n")
      : [
          `Page title: ${snapshot.title}`,
          `URL: ${snapshot.url}`,
          `Context mode: full page`,
          `Captured at: ${snapshot.capturedAt}`,
          "",
          "Page context:",
          snapshot.text,
          "",
          "User question:",
          question
        ].join("\n");

  const recentConversation = conversation
    .filter((message) => message?.role === "user" || message?.role === "assistant")
    .slice(-8)
    .map((message) => ({
      role: message.role,
      content: String(message.content ?? "")
    }))
    .filter((message) => message.content.trim());

  return [...recentConversation, { role: "user", content: userPrompt }];
}

async function readStreamingText(response, readDelta, readFallbackText, onToken) {
  if (!response.ok) {
    await readJsonResponse(response);
  }

  if (!response.body) {
    throw new Error("Provider did not return a readable stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let rawText = "";
  let text = "";

  while (true) {
    const { value, done } = await reader.read();
    const chunk = decoder.decode(value ?? new Uint8Array(), { stream: !done });
    buffer += chunk;
    rawText += chunk;

    const events = buffer.split(/\r?\n\r?\n/);
    buffer = done ? "" : events.pop() ?? "";

    for (const event of events) {
      for (const line of event.split(/\r?\n/)) {
        const trimmed = line.trim();

        if (!trimmed.startsWith("data:")) {
          continue;
        }

        const data = trimmed.slice(5).trim();

        if (!data || data === "[DONE]") {
          continue;
        }

        let json;

        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }

        const delta = readDelta(json);

        if (delta) {
          text += delta;
          onToken?.(delta, text);
        }
      }
    }

    if (done) {
      break;
    }
  }

  if (text.trim()) {
    return text.trim();
  }

  try {
    return readFallbackText(JSON.parse(rawText.trim()));
  } catch {
    return "No response text was returned.";
  }
}

function readChatCompletionsStreamDelta(json) {
  return json.choices?.[0]?.delta?.content ?? "";
}

function readResponsesStreamDelta(json) {
  if (json.type === "response.output_text.delta") {
    return json.delta ?? "";
  }

  return json.delta?.text ?? json.output_text ?? "";
}

function readChatCompletionsText(json) {
  return json.choices?.[0]?.message?.content?.trim() || "No response text was returned.";
}

function readResponsesText(json) {
  if (typeof json.output_text === "string") {
    return json.output_text.trim();
  }

  const text = json.output
    ?.flatMap((item) => item.content ?? [])
    ?.map((content) => content.text ?? "")
    ?.join("")
    ?.trim();

  return text || "No response text was returned.";
}

function formatProviderError(status) {
  if (status === 401 || status === 403) {
    return "Provider rejected the API key.";
  }

  if (status === 404) {
    return "This provider does not appear to support the selected endpoint.";
  }

  return "Could not reach provider. Check the Base URL and API style.";
}
