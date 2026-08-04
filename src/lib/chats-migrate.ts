import { promises as fs } from "fs";
import path from "path";
import { Chat } from "./types";
import { loadBlob } from "./server-store";
import { saveChat, isMigrated } from "./chats-store";
import { withLock } from "./mutex";

/**
 * One-time migration: split the legacy single-blob state
 * (`state-<user>.json`, which held every chat and every message) into
 * one file per chat.
 *
 * Safety properties:
 *  - Idempotent: returns immediately if this user already has an index.
 *  - Non-destructive: the original blob is left in place AND copied to
 *    `state-<user>.json.pre-split.bak` before anything is written.
 *  - Partial failure is safe: chats are written individually, and a re-run
 *    only fills in what is missing.
 */

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const safe = (s: string) => s.replace(/[^\w.-]+/g, "_");

export interface MigrationResult {
  migrated: boolean;
  chats: number;
  messages: number;
  backup?: string;
  reason?: string;
}

/** The persisted Zustand shape: { state: {...}, version: n }. */
interface PersistedBlob {
  state?: { chats?: Chat[] };
}

export async function migrateUserChats(userKey: string): Promise<MigrationResult> {
  return withLock(`chats-migrate:${safe(userKey)}`, async () => {
    if (await isMigrated(userKey)) {
      return { migrated: false, chats: 0, messages: 0, reason: "already migrated" };
    }

    const raw = await loadBlob(userKey);
    if (!raw) {
      // No legacy state — create an empty index so we don't re-check forever.
      await fs.mkdir(path.join(DATA_DIR, "chats", safe(userKey)), { recursive: true });
      await fs.writeFile(
        path.join(DATA_DIR, "chats", safe(userKey), "index.json"),
        "[]",
        "utf-8"
      );
      return { migrated: true, chats: 0, messages: 0, reason: "no legacy blob" };
    }

    let parsed: PersistedBlob;
    try {
      parsed = JSON.parse(raw) as PersistedBlob;
    } catch {
      return { migrated: false, chats: 0, messages: 0, reason: "legacy blob is not valid JSON" };
    }

    const chats = parsed.state?.chats ?? [];

    // Back up the original before writing anything.
    const backup = path.join(DATA_DIR, `state-${safe(userKey)}.json.pre-split.bak`);
    try {
      await fs.writeFile(backup, raw, "utf-8");
    } catch (err) {
      return {
        migrated: false,
        chats: 0,
        messages: 0,
        reason: `could not write backup: ${err instanceof Error ? err.message : "unknown"}`,
      };
    }

    let messages = 0;
    for (const chat of chats) {
      if (!chat?.id) continue;
      const withDefaults: Chat = {
        ...chat,
        messages: chat.messages ?? [],
        pinned: !!chat.pinned,
        createdAt: chat.createdAt ?? new Date().toISOString(),
        updatedAt: chat.updatedAt ?? chat.createdAt ?? new Date().toISOString(),
      };
      await saveChat(userKey, withDefaults);
      messages += withDefaults.messages.length;
    }

    // Ensure an index exists even when the blob had zero chats.
    if (chats.length === 0) {
      await fs.mkdir(path.join(DATA_DIR, "chats", safe(userKey)), { recursive: true });
      await fs.writeFile(
        path.join(DATA_DIR, "chats", safe(userKey), "index.json"),
        "[]",
        "utf-8"
      );
    }

    console.log(
      `[chats-migrate] ${userKey}: split ${chats.length} chats (${messages} messages); backup at ${backup}`
    );
    return { migrated: true, chats: chats.length, messages, backup };
  });
}
