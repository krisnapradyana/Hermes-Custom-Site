import { NextResponse } from "next/server";
import { requireUser } from "@/lib/user-key";
import { readMembers } from "@/lib/members-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Profile enrichment for the team page, keyed by Slack id: the member's role
 * from the Member Directory + their Slack profile image. Kept separate from
 * /api/team on purpose — that one refreshes every 15s, this one is fetched
 * once per page view and the Slack half is cached server-side so we don't
 * hammer users.list.
 */

interface Profile {
  role?: string;
  type?: string;
  avatar?: string;
}

interface SlackApiUser {
  id: string;
  deleted?: boolean;
  is_bot?: boolean;
  profile?: { image_192?: string; image_72?: string };
}

let avatarCache: { at: number; map: Record<string, string> } | null = null;
const AVATAR_TTL_MS = 10 * 60_000;

async function slackAvatars(): Promise<Record<string, string>> {
  if (avatarCache && Date.now() - avatarCache.at < AVATAR_TTL_MS) return avatarCache.map;
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return {};

  const map: Record<string, string> = {};
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
        members?: SlackApiUser[];
        response_metadata?: { next_cursor?: string };
      };
      if (!data.ok) break;
      for (const u of data.members ?? []) {
        if (u.deleted || u.is_bot) continue;
        const img = u.profile?.image_192 || u.profile?.image_72;
        if (img) map[u.id] = img;
      }
      cursor = data.response_metadata?.next_cursor || undefined;
    } while (cursor);
  } catch {
    /* Slack unreachable — the UI falls back to initials */
  }
  avatarCache = { at: Date.now(), map };
  return map;
}

export async function GET() {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;

  const [members, avatars] = await Promise.all([readMembers(), slackAvatars()]);

  const profiles: Record<string, Profile> = {};
  for (const [id, avatar] of Object.entries(avatars)) profiles[id] = { avatar };
  for (const m of members) {
    if (!m.slackId) continue;
    profiles[m.slackId] = { ...profiles[m.slackId], role: m.primaryRole, type: m.type };
  }
  return NextResponse.json({ profiles });
}
