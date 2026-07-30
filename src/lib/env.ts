import { existsSync } from "fs";
import path from "path";

/**
 * Boot-time environment validation. Called once from instrumentation.ts
 * when the server starts. The goal: configuration mistakes fail LOUDLY at
 * boot instead of degrading silently at runtime — a typo'd DRIVE_MOUNT_DIR
 * used to redefine the filesystem allowlist without a single log line, and
 * a missing AUTH_SECRET turned into "every API call 401s" with no clue why.
 */

export interface EnvReport {
  fatal: string[];
  warnings: string[];
}

const isAbs = (p: string) => path.isAbsolute(p);

export function validateEnv(): EnvReport {
  const fatal: string[] = [];
  const warnings: string[] = [];
  const e = process.env;

  // --- Hermes upstream ---
  if (!e.HERMES_API_URL) {
    fatal.push("HERMES_API_URL is not set — the app cannot reach the agent. See .env.example.");
  } else if (!/^https?:\/\//.test(e.HERMES_API_URL)) {
    fatal.push(`HERMES_API_URL must start with http(s):// — got "${e.HERMES_API_URL}".`);
  }
  if (!e.HERMES_API_KEY) {
    warnings.push("HERMES_API_KEY is empty — requests to Hermes will be unauthenticated.");
  }
  const mode = e.HERMES_API_MODE ?? "custom";
  if (mode !== "openai" && mode !== "custom") {
    fatal.push(`HERMES_API_MODE must be "openai" or "custom" — got "${mode}".`);
  }

  // --- Auth ---
  const authEnabled = e.NEXT_PUBLIC_AUTH_ENABLED === "true";
  if (authEnabled) {
    if (!e.AUTH_SECRET) fatal.push("AUTH_SECRET is required when NEXT_PUBLIC_AUTH_ENABLED=true.");
    else if (e.AUTH_SECRET.length < 32)
      warnings.push("AUTH_SECRET is shorter than 32 chars — generate one with `openssl rand -base64 33`.");
    if (!e.AUTH_SLACK_ID) fatal.push("AUTH_SLACK_ID is required when auth is enabled.");
    if (!e.AUTH_SLACK_SECRET) fatal.push("AUTH_SLACK_SECRET is required when auth is enabled.");
    if (!e.AUTH_URL) warnings.push("AUTH_URL is not set — Slack OAuth redirects may use the wrong host.");
  } else if (e.NODE_ENV === "production") {
    warnings.push(
      "AUTH IS DISABLED in a production build (NEXT_PUBLIC_AUTH_ENABLED != \"true\"): " +
        "every visitor shares one identity and all API routes are open. " +
        "Only acceptable on a single-user machine that is not exposed."
    );
  }

  // --- Filesystem roots ---
  const mount = e.DRIVE_MOUNT_DIR ?? "/gdrive";
  if (!isAbs(mount)) fatal.push(`DRIVE_MOUNT_DIR must be an absolute path — got "${mount}".`);
  else if (!existsSync(mount))
    warnings.push(
      `DRIVE_MOUNT_DIR "${mount}" does not exist — the workspace panel and folder pickers ` +
        `will show nothing. Is the rclone mount up (and typo-free)?`
    );

  for (const d of (e.AGENT_DATA_DIRS ?? "/opt/data").split(",").map((s) => s.trim()).filter(Boolean)) {
    if (!isAbs(d)) fatal.push(`AGENT_DATA_DIRS entries must be absolute paths — got "${d}".`);
    else if (!existsSync(d))
      warnings.push(`AGENT_DATA_DIRS "${d}" does not exist — agent-file downloads will 404 until it is mounted.`);
  }

  const dataDir = e.DATA_DIR ?? path.join(process.cwd(), "data");
  if (!isAbs(dataDir)) warnings.push(`DATA_DIR should be absolute — got "${dataDir}".`);

  return { fatal, warnings };
}

/** Log the report; throw if anything is fatal (kills boot on purpose). */
export function assertEnv(): void {
  const { fatal, warnings } = validateEnv();
  for (const w of warnings) console.warn(`[env] WARNING: ${w}`);
  if (fatal.length > 0) {
    for (const f of fatal) console.error(`[env] FATAL: ${f}`);
    throw new Error(
      `Environment validation failed (${fatal.length} fatal issue${fatal.length === 1 ? "" : "s"}) — see [env] FATAL lines above.`
    );
  }
  console.log("[env] configuration OK");
}
