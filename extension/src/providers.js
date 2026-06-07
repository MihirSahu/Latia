export async function sendProviderRequest({ provider, snapshot, question, stream = false }) {
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

  if (provider.apiStyle === "responses") {
    const response = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: provider.model,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        stream
      })
    });

    const json = await readJsonResponse(response);
    return readResponsesText(json);
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      stream
    })
  });

  const json = await readJsonResponse(response);
  return json.choices?.[0]?.message?.content?.trim() || "No response text was returned.";
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
  const originPattern = getOriginPattern(provider.baseUrl);

  if (!originPattern) {
    throw new Error("Enter a valid provider Base URL.");
  }

  const hasPermission = await chrome.permissions.contains({
    origins: [originPattern]
  });

  if (hasPermission) {
    return true;
  }

  const granted = await chrome.permissions.request({
    origins: [originPattern]
  });

  if (!granted) {
    throw new Error("Latia needs access to the provider origin before it can send requests.");
  }

  return true;
}

function getOriginPattern(baseUrl) {
  let url;

  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  return `${url.origin}/*`;
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
