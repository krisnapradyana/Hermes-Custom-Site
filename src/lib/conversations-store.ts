import { promises as fs } from "fs";
import path from "path";
import { Conversation, ConversationMeta, Message } from "./types";

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

let counter = 0;
const uid = () => `conv-${Date.now()}-${counter++}`;

export async function createConversation(
  projectId: string,
  title: string,
  createdBy: { name: string; slackId?: string }
): Promise<Conversation> {
  const now = new Date().toISOString();
  const conv: Conversation = {
    id: uid(),
    projectId,
    title: title.slice(0, 80) || "New conversation",
    createdBy,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    messages: [],
  };
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(file(conv.id), JSON.stringify(conv, null, 2), "utf-8");
  const idx = await readIndex();
  idx.push(toMeta(conv));
  await writeIndex(idx);
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
  await fs.writeFile(file(cid), JSON.stringify(conv, null, 2), "utf-8");
  const idx = await readIndex();
  const i = idx.findIndex((c) => c.id === cid);
  if (i >= 0) idx[i] = toMeta(conv);
  await writeIndex(idx);
  return conv;
}

export async function deleteConversation(cid: string): Promise<void> {
  try {
    await fs.unlink(file(cid));
  } catch {}
  const idx = await readIndex();
  await writeIndex(idx.filter((c) => c.id !== cid));
}
