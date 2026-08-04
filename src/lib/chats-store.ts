import { promises as fs } from "fs";
import path from "path";
import { Chat, Message } from "./types";
import { withLock } from "./mutex";

/**
 * Per-user private chats, stored ONE FILE PER CHAT.
 *
 * Previously every chat (with all messages) lived in a single
 * `state-<user>.json` blob. That blob reached 8 MB for one user, and the whole
 * thing was re-serialised, re-uploaded and re-written on an 800 ms debounce
 * during streaming — the root cause of heavy page loads and laggy replies.
 *
 * Layout, per user:
 *   chats/<user>/index.json      metadata only (title, pinned, counts, dates)
 *   chats/<user>/<chatId>.json   the messages for one chat
 *
 * Reads of the list therefore never touch message bodies, and writing a
 * message only rewrites that one chat.
 */

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");

const safe = (s: string) => s.replace(/[^\w.-]+/g, "_");
const userDir = (userKey: string) => path.join(DATA_DIR, "chats", safe(userKey));
const indexFile = (userKey: string) => path.join(userDir(userKey), "index.json");
const chatFile = (userKey: string, chatId: string) =>
  path.join(userDir(userKey), `${safe(chatId)}.json`);

/** Chat without its messages — what the sidebar and lists need. */
export type ChatMeta = Omit<Chat, "messages"> & { messageCount: number };

async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmp, file);
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

export async function listChats(userKey: string): Promise<ChatMeta[]> {
  const list = await readJson<ChatMeta[]>(indexFile(userKey), []);
  return list.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export async function getChat(userKey: string, chatId: string): Promise<Chat | null> {
  return readJson<Chat | null>(chatFile(userKey, chatId), null);
}

/** Serialize index updates: every message save touches this one file. */
function indexLock(userKey: string): string {
  return `chats-index:${safe(userKey)}`;
}

const toMeta = (c: Chat): ChatMeta => ({
  id: c.id,
  title: c.title,
  pinned: c.pinned,
  projectId: c.projectId,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
  messageCount: c.messages?.length ?? 0,
});

async function upsertIndex(userKey: string, meta: ChatMeta): Promise<void> {
  await withLock(indexLock(userKey), async () => {
    const list = await readJson<ChatMeta[]>(indexFile(userKey), []);
    const i = list.findIndex((c) => c.id === meta.id);
    if (i >= 0) list[i] = meta;
    else list.push(meta);
    await writeJsonAtomic(indexFile(userKey), list);
  });
}

/** Create or replace a whole chat (messages included). */
export async function saveChat(userKey: string, chat: Chat): Promise<void> {
  const full: Chat = { ...chat, messages: chat.messages ?? [] };
  await writeJsonAtomic(chatFile(userKey, chat.id), full);
  await upsertIndex(userKey, toMeta(full));
}

/** Replace just the messages of an existing chat (the hot path). */
export async function saveChatMessages(
  userKey: string,
  chatId: string,
  messages: Message[],
  patch?: Partial<Pick<Chat, "title" | "pinned">>
): Promise<Chat | null> {
  const existing = await getChat(userKey, chatId);
  if (!existing) return null;
  const updated: Chat = {
    ...existing,
    ...patch,
    messages,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(chatFile(userKey, chatId), updated);
  await upsertIndex(userKey, toMeta(updated));
  return updated;
}

/** Update metadata only (pin, rename) without rewriting messages. */
export async function patchChatMeta(
  userKey: string,
  chatId: string,
  patch: Partial<Pick<Chat, "title" | "pinned">>
): Promise<ChatMeta | null> {
  const existing = await getChat(userKey, chatId);
  if (!existing) return null;
  const updated: Chat = { ...existing, ...patch };
  await writeJsonAtomic(chatFile(userKey, chatId), updated);
  const meta = toMeta(updated);
  await upsertIndex(userKey, meta);
  return meta;
}

export async function deleteChat(userKey: string, chatId: string): Promise<void> {
  try {
    await fs.unlink(chatFile(userKey, chatId));
  } catch {}
  await withLock(indexLock(userKey), async () => {
    const list = await readJson<ChatMeta[]>(indexFile(userKey), []);
    await writeJsonAtomic(
      indexFile(userKey),
      list.filter((c) => c.id !== chatId)
    );
  });
}

export interface ChatSearchHit {
  chat: ChatMeta;
  snippet: string;
}

/**
 * Search titles and message bodies. Runs on the server so the client never
 * holds every message in memory — the old client-side scan walked an 8 MB
 * blob on every keystroke.
 */
export async function searchChats(
  userKey: string,
  query: string,
  limit = 30
): Promise<ChatSearchHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const metas = await listChats(userKey);
  const hits: ChatSearchHit[] = [];

  for (const meta of metas) {
    if (hits.length >= limit) break;
    if (meta.title.toLowerCase().includes(q)) {
      hits.push({ chat: meta, snippet: "" });
      continue;
    }
    const chat = await getChat(userKey, meta.id);
    const msg = chat?.messages.find((m) => m.content?.toLowerCase().includes(q));
    if (!msg) continue;
    const i = msg.content.toLowerCase().indexOf(q);
    const start = Math.max(0, i - 40);
    hits.push({
      chat: meta,
      snippet:
        (start > 0 ? "…" : "") +
        msg.content.slice(start, i + q.length + 60).replace(/\s+/g, " ") +
        "…",
    });
  }
  return hits;
}

export interface ChatAttachment {
  name: string;
  type: string;
  size: number;
  id?: string;
  chatId: string;
  chatTitle: string;
  createdAt: string;
}

/** Every attachment across a user's chats (newest chat first). */
export async function collectChatAttachments(
  userKey: string,
  limit = 500
): Promise<ChatAttachment[]> {
  const out: ChatAttachment[] = [];
  for (const meta of await listChats(userKey)) {
    if (out.length >= limit) break;
    const chat = await getChat(userKey, meta.id);
    for (const m of chat?.messages ?? []) {
      for (const a of m.attachments ?? []) {
        out.push({
          name: a.name,
          type: a.type,
          size: a.size,
          id: a.id,
          chatId: meta.id,
          chatTitle: meta.title,
          createdAt: m.createdAt,
        });
      }
    }
  }
  return out;
}

/** True once this user's chats have been split out of the legacy blob. */
export async function isMigrated(userKey: string): Promise<boolean> {
  try {
    await fs.access(indexFile(userKey));
    return true;
  } catch {
    return false;
  }
}
