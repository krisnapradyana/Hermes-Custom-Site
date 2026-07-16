/** Server-side helper for Hermes admin REST APIs (/api/jobs, /api/sessions). */

const API_URL = process.env.HERMES_API_URL ?? "";
const API_KEY = process.env.HERMES_API_KEY ?? "";

export async function hermesFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!API_URL) {
    return new Response(JSON.stringify({ error: "HERMES_API_URL not configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string>),
  };
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(15_000),
  });
}

export async function passthrough(path: string, init?: RequestInit): Promise<Response> {
  try {
    const res = await hermesFetch(path, init);
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return new Response(JSON.stringify({ error: `Hermes unreachable: ${msg}` }), {
      status: 504,
      headers: { "Content-Type": "application/json" },
    });
  }
}
