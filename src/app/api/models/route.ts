import { NextResponse } from "next/server";
import { getUserKey } from "@/lib/user-key";
import { parseChoices } from "@/lib/model-choices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Model choices for the composer dropdown — see lib/model-choices.ts. */
export async function GET() {
  if (!(await getUserKey())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ models: parseChoices(process.env.HERMES_MODEL_CHOICES) });
}
