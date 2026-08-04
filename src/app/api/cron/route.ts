import { NextRequest } from "next/server";
import { requireUser } from "@/lib/user-key";
import { passthrough } from "@/lib/hermes-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  return passthrough("/api/jobs");
}

export async function POST(req: NextRequest) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const body = await req.text();
  return passthrough("/api/jobs", { method: "POST", body });
}
