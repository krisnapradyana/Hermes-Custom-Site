import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Deploy beacon. Returns the Next.js build id so long-open tabs can detect
 * that a new version was deployed (their JS chunks no longer exist on the
 * server) and prompt a refresh instead of silently dead-clicking.
 * Public route — must work even with an expired session.
 */

// Fallback if BUILD_ID can't be read: process boot time still changes on
// every deploy, which is all the client needs.
const BOOT = new Date().toISOString();
let cached: string | null = null;

async function buildId(): Promise<string> {
  if (cached) return cached;
  try {
    cached = (await fs.readFile(path.join(process.cwd(), ".next", "BUILD_ID"), "utf-8")).trim();
  } catch {
    cached = `boot-${BOOT}`;
  }
  return cached;
}

export async function GET() {
  return NextResponse.json(
    { buildId: await buildId() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
