"use client";

import { useEffect, useState } from "react";
import { checkGateway, GatewayHealth } from "@/lib/hermes-api";
import pkg from "../../package.json";

const version = pkg.version;

interface ServerStatus {
  level: "good" | "moderate" | "overloaded";
  cpuPct: number;
  memFreePct: number;
}

const LEVEL_UI: Record<ServerStatus["level"], { label: string; dot: string }> = {
  good: { label: "Good", dot: "bg-green-500" },
  moderate: { label: "Moderate", dot: "bg-amber-400" },
  overloaded: { label: "Overloaded", dot: "bg-red-500" },
};

/** Slim app-wide bottom bar: gateway status + server load + app version. */
export function StatusBar() {
  const [health, setHealth] = useState<GatewayHealth | null>(null);
  const [server, setServer] = useState<ServerStatus | null>(null);

  useEffect(() => {
    let alive = true;
    const ping = () => checkGateway().then((h) => alive && setHealth(h));
    ping();
    const t = setInterval(ping, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Server load: every 5s, but only while the tab is visible.
  useEffect(() => {
    let alive = true;
    const ping = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/server-status", { cache: "no-store" });
        if (res.ok && alive) setServer(await res.json());
      } catch {}
    };
    ping();
    const t = setInterval(ping, 5_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const label = !health
    ? "Checking gateway…"
    : health.reachable
      ? "Hermes online"
      : health.configured
        ? "Gateway unreachable"
        : "Gateway not configured";

  const lvl = server ? LEVEL_UI[server.level] : null;

  return (
    <footer className="h-6 shrink-0 border-t border-line bg-sidebar flex items-center justify-between px-3 text-[10.5px] text-ink-faint select-none">
      <span className="flex items-center gap-3 min-w-0">
        <span className="flex items-center gap-1.5 min-w-0" title={health?.detail ?? ""}>
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              !health
                ? "bg-line"
                : health.reachable
                  ? "bg-green-500"
                  : health.configured
                    ? "bg-red-500"
                    : "bg-amber-400"
            }`}
          />
          <span className="truncate">{label}</span>
        </span>

        {lvl && (
          <span
            className="flex items-center gap-1.5 shrink-0"
            title={`CPU load ${server!.cpuPct}% of capacity · RAM free ${server!.memFreePct}%`}
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${lvl.dot}`} />
            <span>Server Status: {lvl.label}</span>
          </span>
        )}
      </span>
      <span className="shrink-0">SuperPixel Assistant · v{version}</span>
    </footer>
  );
}
