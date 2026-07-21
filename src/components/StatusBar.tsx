"use client";

import { useEffect, useState } from "react";
import { checkGateway, GatewayHealth } from "@/lib/hermes-api";
import pkg from "../../package.json";

const version = pkg.version;

/** Slim app-wide bottom bar: subtle gateway status + app version. */
export function StatusBar() {
  const [health, setHealth] = useState<GatewayHealth | null>(null);

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

  const label = !health
    ? "Checking gateway…"
    : health.reachable
    ? "Hermes online"
    : health.configured
    ? "Gateway unreachable"
    : "Gateway not configured";

  return (
    <footer className="h-6 shrink-0 border-t border-line bg-sidebar flex items-center justify-between px-3 text-[10.5px] text-ink-faint select-none">
      <span className="flex items-center gap-1.5 min-w-0" title={health?.url ?? health?.detail ?? ""}>
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
      <span className="shrink-0">SuperPixel Assistant · v{version}</span>
    </footer>
  );
}
