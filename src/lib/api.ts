/**
 * Tiny client-side fetch helper. Every call site was repeating
 * `{ cache: "no-store" }`, the JSON headers, and the same
 * `data.error ?? "something went wrong"` unwrapping.
 *
 * Returns a discriminated result instead of throwing, so callers handle
 * failure explicitly rather than with an empty catch block.
 */

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      cache: "no-store",
      ...init,
      headers:
        init?.body != null
          ? { "Content-Type": "application/json", ...(init?.headers ?? {}) }
          : init?.headers,
    });
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      // Expired session: every call quietly 401s and pages sit on "Loading…"
      // forever. Tell UpdateGuard so it can show the sign-in banner.
      if (res.status === 401 && typeof window !== "undefined") {
        window.dispatchEvent(new Event("spx:unauthorized"));
      }
      const err =
        (parsed && typeof parsed === "object" && "error" in parsed
          ? String((parsed as { error?: unknown }).error)
          : null) ?? `Request failed (${res.status})`;
      return { ok: false, error: err };
    }
    return { ok: true, data: parsed as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body == null ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body == null ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body == null ? undefined : JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
