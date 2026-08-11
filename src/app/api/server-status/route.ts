import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import os from "os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Coarse server-load indicator for the status bar: Good / Moderate /
 * Overloaded, derived from CPU load average and available memory.
 *
 * Inside a container /proc/loadavg and /proc/meminfo reflect the HOST
 * (shared kernel), which is exactly what we want — the whole VM's health.
 *
 * Public like /api/hermes/health (it feeds the pre-login status bar too);
 * the payload is deliberately coarse. Cached for 4s server-side so 20 users
 * polling every 5s cost one /proc read per window, not twenty.
 */

export type ServerLevel = "good" | "moderate" | "overloaded";

interface Status {
  level: ServerLevel;
  cpuPct: number; // load1 / cores, as %
  memFreePct: number; // MemAvailable / MemTotal, as %
}

let cache: { at: number; status: Status } | null = null;

async function measure(): Promise<Status> {
  const cores = os.cpus().length || 1;

  const loadRaw = await fs.readFile("/proc/loadavg", "utf-8");
  const load1 = parseFloat(loadRaw.split(" ")[0] ?? "0");
  const cpuRatio = load1 / cores;

  const memRaw = await fs.readFile("/proc/meminfo", "utf-8");
  const kv = (key: string) => {
    const m = memRaw.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"));
    return m ? parseInt(m[1], 10) : 0;
  };
  const total = kv("MemTotal");
  const available = kv("MemAvailable");
  const memFree = total > 0 ? available / total : 1;

  // Overloaded when either resource is critical; Good only when both are calm.
  const level: ServerLevel =
    cpuRatio > 1.5 || memFree < 0.1
      ? "overloaded"
      : cpuRatio > 0.75 || memFree < 0.25
        ? "moderate"
        : "good";

  return {
    level,
    cpuPct: Math.round(cpuRatio * 100),
    memFreePct: Math.round(memFree * 100),
  };
}

export async function GET() {
  if (cache && Date.now() - cache.at < 4_000) {
    return NextResponse.json(cache.status);
  }
  try {
    const status = await measure();
    cache = { at: Date.now(), status };
    return NextResponse.json(status);
  } catch {
    // /proc unavailable (non-Linux dev machine) — report neutral Good.
    return NextResponse.json({ level: "good", cpuPct: 0, memFreePct: 100 } satisfies Status);
  }
}
