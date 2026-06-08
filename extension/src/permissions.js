export async function ensureHostPermissions(originPatterns, message) {
  const origins = [...new Set(originPatterns.filter(Boolean))];

  if (!origins.length) {
    return true;
  }

  const missingOrigins = [];

  for (const origin of origins) {
    const hasPermission = await chrome.permissions.contains({ origins: [origin] });

    if (!hasPermission) {
      missingOrigins.push(origin);
    }
  }

  if (!missingOrigins.length) {
    return true;
  }

  const granted = await chrome.permissions.request({ origins: missingOrigins });

  if (!granted) {
    throw new Error(message);
  }

  return true;
}

export async function requestHostPermissions(originPatterns, message) {
  const origins = [...new Set(originPatterns.filter(Boolean))];

  if (!origins.length) {
    return true;
  }

  const granted = await chrome.permissions.request({ origins });

  if (!granted) {
    throw new Error(message);
  }

  return true;
}

export function getOriginPattern(urlValue) {
  let url;

  try {
    url = new URL(urlValue);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  return `${url.origin}/*`;
}
