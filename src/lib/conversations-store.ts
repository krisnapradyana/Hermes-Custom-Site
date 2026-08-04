import { promises as fs } from "fs";
import path from "path";
import { Conversation, ConversationMeta, Message } from "./types";
import { withLock } from "./mutex";
import { uid } from "./uid";

/**
 * SHARED, project-scoped conversations. Stored server-side so every member
 * can read them. One JSON file per conversation, plus a lightweight index
 * for fast per-project listing.
 */

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const DIR = path.join(DATA_DIR, "conversations");
const INDEX = path.join(DIR, "index.json");

const safe = (id: string) => id.replace(/[^\w.-]+/g, "_");
const file = (cid: string) => path.join(DIR, safe(cid) + ".json");

async function readIndex(): Promise<ConversationMeta[]> {
  try {
    return JSON.parse(await fs.readFile(INDEX, "utf-8"));
  } catch {
    return [];
  }
}
async function writeIndex(list: ConversationMeta[]): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  const tmp = INDEX + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(list, null, 2), "utf-8");
  await fs.rename(tmp, INDEX);
}

/** Atomic write for a conversation file — a crash mid-write must never
 *  leave a truncated, unparseable JSON behind (that IS data loss, because
 *  getConversation would then return null forever). */
async function writeConv(conv: Conversation): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  const tmp = file(conv.id) + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(conv, null, 2), "utf-8");
  await fs.rename(tmp, file(conv.id));
}

/** All index read-modify-write cycles go through one lock: every user's
 *  message persist touches the same index.json, and unlocked concurrent
 *  updates silently drop entries (conversation vanishes from its project). */
const INDEX_LOCK = "conversations-index";

const toMeta = (c: Conversation): ConversationMeta => ({
  id: c.id,
  projectId: c.projectId,
  title: c.title,
  createdBy: c.createdBy,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
  messageCount: c.messages.length,
});

export async function listByProject(projectId: string): Promise<ConversationMeta[]> {
  const idx = await readIndex();
  return idx
    .filter((c) => c.projectId === projectId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getConversation(cid: string): Promise<Conversation | null> {
  try {
    return JSON.parse(await fs.readFile(file(cid), "utf-8"));
  } catch {
    return null;
  }
}

export async function createConversation(
  projectId: string,
  title: string,
  createdBy: { name: string; slackId?: string }
): Promise<Conversation> {
  const now = new Date().toISOString();
  const conv: Conversation = {
    id: uid("conv"),
    projectId,
    title: title.slice(0, 80) || "New conversation",
    createdBy,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    messages: [],
  };
  await writeConv(conv);
  await withLock(INDEX_LOCK, async () => {
    const idx = await readIndex();
    idx.push(toMeta(conv));
    await writeIndex(idx);
  });
  return conv;
}

export async function saveMessages(
  cid: string,
  messages: Message[],
  title?: string
): Promise<Conversation | null> {
  const conv = await getConversation(cid);
  if (!conv) return null;
  conv.messages = messages;
  conv.messageCount = messages.length;
  conv.updatedAt = new Date().toISOString();
  if (title) conv.title = title.slice(0, 80);
  await writeConv(conv);
  await withLock(INDEX_LOCK, async () => {
    const idx = await readIndex();
    const i = idx.findIndex((c) => c.id === cid);
    if (i >= 0) idx[i] = toMeta(conv);
    else idx.push(toMeta(conv)); // heal a previously lost entry
    await writeIndex(idx);
  });
  return conv;
}

export async function deleteConversation(cid: string): Promise<void> {
  try {
    await fs.unlink(file(cid));
  } catch {}
  await withLock(INDEX_LOCK, async () => {
    const idx = await readIndex();
    await writeIndex(idx.filter((c) => c.id !== cid));
  });
}
