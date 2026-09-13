import { NextResponse } from "next/server";
import { requireDirectoryAccess } from "@/lib/directory-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SlackApiUser {
  id: string;
  deleted?: boolean;
  is_bot?: boolean;
  name?: string;
  profile?: { real_name?: string; display_name?: string };
}

/**
 * Workspace people for the "link Slack account" picker — humans only, sorted
 * by name. Uses the same bot token as task DMs (users:read scope). Returns an
 * empty list (with a hint) when the token is missing or lacks the scope, so
 * the picker degrades to manual id entry instead of erroring.
 */
export async function GET() {
  const gate = await requireDirectoryAccess();
  if (gate.denied) return gate.denied;

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return NextResponse.json({ users: [], hint: "SLACK_BOT_TOKEN not configured" });

  const users: { id: string; name: string }[] = [];
  let cursor: string | undefined;
  try {
    do {
      const qs = new URLSearchParams({ limit: "200" });
      if (cursor) qs.set("cursor", cursor);
      const res = await fetch(`https://slack.com/api/users.list?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        members?: SlackApiUser[];
        response_metadata?: { next_cursor?: string };
      };
      if (!data.ok) return NextResponse.json({ users: [], hint: data.error ?? "slack error" });
      for (const u of data.members ?? []) {
        if (u.deleted || u.is_bot || u.id === "USLACKBOT") continue;
        users.push({
          id: u.id,
          name: u.profile?.display_name || u.profile?.real_name || u.name || u.id,
        });
      }
      cursor = data.response_metadata?.next_cursor || undefined;
    } while (cursor);
  } catch {
    return NextResponse.json({ users: [], hint: "slack unreachable" });
  }

  users.sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ users });
}
