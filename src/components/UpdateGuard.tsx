"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { RefreshCw, LogIn } from "lucide-react";

/**
 * Two failure modes of a long-open tab, made visible:
 *
 * 1. STALE BUILD — after a deploy the old tab's JS chunks no longer exist on
 *    the server, so opening a not-yet-visited page silently does nothing.
 *    We poll /api/version (and re-check the moment the tab becomes visible
 *    again, which is exactly when stale tabs come back to life) and show a
 *    refresh banner when the build id changes. A chunk-load error triggers
 *    one automatic reload; if that doesn't fix it, the banner shows.
 *
 * 2. EXPIRED SESSION — API calls start returning 401 but the UI would just
 *    sit on "Loading…" forever. lib/api dispatches "spx:unauthorized"; we
 *    show a sign-in banner.
 */

const AUTH_ENABLED = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";
const CHUNK_ERR_RE =
  /ChunkLoadError|Loading chunk .* failed|dynamically imported module|Failed to fetch.*chunk/i;
const RELOAD_GUARD_KEY = "spx-chunk-reload-at";

function isChunkError(msg: unknown): boolean {
  return typeof msg === "string" && CHUNK_ERR_RE.test(msg);
}

/** Reload at most once per minute — a second chunk error that fast means
 *  reloading didn't help, so we fall back to the banner. */
function tryAutoReload(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    // sessionStorage unavailable — reload anyway, worst case is a loop the
    // user breaks by closing the tab.
  }
  window.location.reload();
  return true;
}

export function UpdateGuard() {
  const [stale, setStale] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  // --- stale-build detection -------------------------------------------
  useEffect(() => {
    let baseline: string | null = null;
    let stopped = false;

    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { buildId } = (await res.json()) as { buildId?: string };
        if (!buildId || stopped) return;
        if (baseline === null) baseline = buildId;
        else if (buildId !== baseline) setStale(true);
      } catch {
        // Offline / server restarting — try again next tick.
      }
    };

    check();
    const t = setInterval(check, 60_000);
    // The moment a backgrounded tab wakes up is exactly when staleness bites.
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // --- chunk-load failures ---------------------------------------------
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      if (isChunkError(e.message) || isChunkError(e.error?.name)) {
        if (!tryAutoReload()) setStale(true);
      }
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as { name?: string; message?: string } | undefined;
      if (isChunkError(r?.name) || isChunkError(r?.message)) {
        if (!tryAutoReload()) setStale(true);
      }
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  // --- expired session (dispatched by lib/api on any 401) ---------------
  useEffect(() => {
    if (!AUTH_ENABLED) return;
    const onUnauthorized = () => setSessionExpired(true);
    window.addEventListener("spx:unauthorized", onUnauthorized);
    return () => window.removeEventListener("spx:unauthorized", onUnauthorized);
  }, []);

  if (!stale && !sessionExpired) return null;

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 px-4">
      {sessionExpired && (
        <Banner
          text="Your session has expired — data can't load until you sign in again."
          actionLabel="Sign in"
          icon={<LogIn size={13} />}
          onAction={() => signIn("slack")}
        />
      )}
      {stale && !sessionExpired && (
        <Banner
          text="A new version of the assistant was deployed. Refresh to keep everything working."
          actionLabel="Refresh"
          icon={<RefreshCw size={13} />}
          onAction={() => window.location.reload()}
        />
      )}
    </div>
  );
}

function Banner({
  text,
  actionLabel,
  icon,
  onAction,
}: {
  text: string;
  actionLabel: string;
  icon: React.ReactNode;
  onAction: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-card px-4 py-2.5 shadow-lg max-w-[92vw]">
      <span className="text-[13px] text-ink">{text}</span>
      <button
        onClick={onAction}
        className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] text-white hover:bg-accent-hover shrink-0"
      >
        {icon}
        {actionLabel}
      </button>
    </div>
  );
}
