import { promises as fs } from "fs";

/**
 * Shared Google API auth for server routes (Events calendar, Production
 * Tracker sheets). Credentials come from the SAME files Hermes uses — the
 * oauth-helper's token.json (drive/docs/sheets/calendar scopes), mounted at
 * /workspace/documents — with env vars as optional overrides. Access tokens
 * are cached in memory; token.json is re-read every minute so a re-auth via
 * the oauth-helper is picked up without a restart.
 */

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN ?? "";
const TOKEN_FILE = process.env.GOOGLE_TOKEN_FILE ?? "/workspace/documents/token.json";
const SECRET_FILE =
  process.env.GOOGLE_CLIENT_SECRET_FILE ?? "/workspace/documents/google_client_secret.json";
// Overridable for tests.
export const GOOGLE_TOKEN_URL =
  process.env.GOOGLE_TOKEN_URL ?? "https://oauth2.googleapis.com/token";
export const GOOGLE_API_BASE = process.env.GOOGLE_API_BASE ?? "https://www.googleapis.com";
/** Sheets v4 lives on its OWN host — www.googleapis.com/sheets/v4 404s. */
export const GOOGLE_SHEETS_BASE =
  process.env.GOOGLE_SHEETS_BASE ?? process.env.GOOGLE_API_BASE ?? "https://sheets.googleapis.com";

interface Creds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

let credsCache: { at: number; creds: Creds | null } | null = null;

export async function loadGoogleCreds(): Promise<Creds | null> {
  if (CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN) {
    return { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: REFRESH_TOKEN };
  }
  if (credsCache && Date.now() - credsCache.at < 60_000) return credsCache.creds;
  let creds: Creds | null = null;
  try {
    const tok = JSON.parse(await fs.readFile(TOKEN_FILE, "utf-8")) as {
      refresh_token?: string;
      client_id?: string;
      client_secret?: string;
    };
    let clientId = tok.client_id ?? "";
    let clientSecret = tok.client_secret ?? "";
    if (!clientId || !clientSecret) {
      try {
        const sec = JSON.parse(await fs.readFile(SECRET_FILE, "utf-8")) as {
          installed?: { client_id?: string; client_secret?: string };
          web?: { client_id?: string; client_secret?: string };
        };
        const node = sec.installed ?? sec.web ?? {};
        clientId = clientId || (node.client_id ?? "");
        clientSecret = clientSecret || (node.client_secret ?? "");
      } catch {}
    }
    if (tok.refresh_token && clientId && clientSecret) {
      creds = { clientId, clientSecret, refreshToken: tok.refresh_token };
    }
  } catch {
    creds = null;
  }
  credsCache = { at: Date.now(), creds };
  return creds;
}

let tokenCache: { token: string; exp: number } | null = null;

export async function googleAccessToken(): Promise<string | null> {
  const creds = await loadGoogleCreds();
  if (!creds) return null;
  if (tokenCache && Date.now() < tokenCache.exp - 60_000) return tokenCache.token;
  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: creds.refreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn(
        `[google-auth] token refresh failed: ${res.status} ${(await res.text()).slice(0, 200)}`
      );
      credsCache = null; // token.json may have rotated — re-read next time
      return null;
    }
    const j = (await res.json()) as { access_token: string; expires_in?: number };
    tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return tokenCache.token;
  } catch (err) {
    console.warn(`[google-auth] token error: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
