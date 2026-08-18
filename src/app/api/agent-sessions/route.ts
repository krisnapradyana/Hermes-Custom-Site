import { NextRequest } from "next/server";
import { requireUser } from "@/lib/user-key";
import { passthrough } from "@/lib/hermes-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const limit = req.nextUrl.searchParams.get("limit") ?? "50";
  return passthrough(`/api/sessions?limit=${encodeURIComponent(limit)}`);
}
