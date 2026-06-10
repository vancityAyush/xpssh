import type { Provider } from "../core/providers/index.js";

export interface UploadOutcome {
  ok: boolean;
  message: string;
}

/** Upload a public key via the provider REST API. `fetchFn` is injectable for tests. */
export async function uploadKey(
  provider: Provider,
  token: string,
  title: string,
  publicKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<UploadOutcome> {
  if (!provider.api) {
    return { ok: false, message: `${provider.label} has no key-upload API — add it manually at ${provider.settingsUrl}` };
  }

  const request = provider.api.buildUploadRequest(token, title, publicKey);
  let url = request.url;

  if (url.includes("{uuid}")) {
    // Bitbucket: resolve the account uuid first
    const who = await fetchFn("https://api.bitbucket.org/2.0/user", {
      headers: { Authorization: request.headers["Authorization"]! },
    });
    if (!who.ok) {
      return { ok: false, message: `Token rejected while looking up your Bitbucket account (HTTP ${who.status})` };
    }
    const { uuid } = (await who.json()) as { uuid: string };
    url = url.replace("{uuid}", encodeURIComponent(uuid));
  }

  const response = await fetchFn(url, { method: request.method, headers: request.headers, body: request.body });
  if (response.ok) {
    return { ok: true, message: `Public key uploaded to ${provider.label}` };
  }

  let detail = "";
  try {
    const body = (await response.json()) as { message?: string; error?: { message?: string } };
    detail = body.message ?? body.error?.message ?? "";
  } catch {
    // non-JSON error body
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, message: `Token rejected by ${provider.label} (HTTP ${response.status}) — ${provider.api.tokenHint}` };
  }
  if (response.status === 422 || /already in use|has already been taken/i.test(detail)) {
    return { ok: true, message: `${provider.label} reports this key is already registered` };
  }
  return { ok: false, message: `${provider.label} upload failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}` };
}
