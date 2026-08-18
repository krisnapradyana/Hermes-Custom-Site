"use client";

import { Attachment, Project } from "./types";
import { api } from "./api";

/**
 * The ONE definition of how a turn is sent to the agent.
 *
 * Private chats (Zustand store) and shared project conversations used to
 * implement this twice, and the two copies had drifted — the agent received
 * different file-safety wording depending on which page you typed in. Both
 * paths now build context and upload attachments through here.
 */

const SAFETY_RULES =
  `File-safety rules: only CREATE new files; never delete or move files; if a ` +
  `change to an existing file is needed, save a new versioned copy ` +
  `(e.g. name-v2.ext) and tell the user — never overwrite the original.`;

const REPORT_PATH =
  `When you finish a file, always tell the user its full absolute path — the ` +
  `interface turns that path into a download button.`;

/** Where private-chat deliverables go (keeps them out of Hermes' data root). */
const PRIVATE_OUTPUT_DIR = "/opt/data/outputs";

/**
 * Chat auto-naming, without a separate (tool-definition-laden, token-costly)
 * API call: on the FIRST turn only, the agent is asked to end its reply with
 * a tagged title line. The tag is stripped from what the user sees and
 * becomes the chat's name. If the agent forgets, the first-message
 * truncation stays — graceful fallback, zero extra requests.
 */
const TITLE_REQUEST =
  ` At the very end of this reply, on its own final line, write ` +
  `<chat-title>a 3–6 word topic name, in the user's language</chat-title>. ` +
  `It names this conversation and is hidden from the user — do not refer to it.`;

/**
 * Build the system context for a turn. Identical for every send path.
 * @param project    the chat's project, if any
 * @param mentions   files the user referenced with "@" (project-relative)
 * @param askTitle   true on a conversation's first turn — requests the title tag
 */
export function buildAgentContext(
  project?: Project,
  mentions?: string[],
  askTitle = false
): string {
  const title = askTitle ? TITLE_REQUEST : "";
  if (project?.workingFolder) {
    const mentionNote = mentions?.length
      ? `\nThe user referenced these project files — read them from disk:\n` +
        mentions.map((m) => `- ${project.workingFolder}/${m}`).join("\n")
      : "";
    return (
      `The user is working in project "${project.name}". Working folder: ` +
      `${project.workingFolder} — it is the team's shared Drive, mounted on this ` +
      `machine. Read project files from there and save all generated files there. ` +
      `${REPORT_PATH} ${SAFETY_RULES}${title}${mentionNote}`
    );
  }
  return (
    `This is a private chat with no project folder. Save any files you generate ` +
    `in ${PRIVATE_OUTPUT_DIR}/ (create the folder if needed), not in the data root. ` +
    `${REPORT_PATH} ${SAFETY_RULES}${title}`
  );
}

// The tag must sit on its OWN LINE at the very end (as instructed) — a
// mid-sentence mention of "<chat-title>" in prose is never treated as one.
const TITLE_TAG_RE = /(?:^|\n)\s*<chat-title>([^\n<]{1,160}?)<\/chat-title>\s*$/;

/** Is position i preceded only by whitespace on its line? */
const atLineStart = (s: string, i: number) => /(?:^|\n)[ \t]*$/.test(s.slice(0, i));

/** Final content → { visible content, title? }. */
export function extractChatTitle(content: string): { content: string; title?: string } {
  const m = content.match(TITLE_TAG_RE);
  if (!m || m.index == null) return { content: stripTitleForDisplay(content) };
  const title = m[1].trim().replace(/^["'“”]+|["'“”]+$/g, "").slice(0, 60);
  return { content: content.slice(0, m.index).trimEnd(), title: title || undefined };
}

/**
 * Hide the title tag while the reply is still STREAMING — including a
 * partially received tag ("<chat-tit") — so it never flashes on screen.
 */
export function stripTitleForDisplay(content: string): string {
  // Complete tag at the end.
  const m = content.match(TITLE_TAG_RE);
  if (m && m.index != null) return content.slice(0, m.index).trimEnd();
  // Tag opened on its own line near the end but not yet closed (streaming).
  const open = content.lastIndexOf("<chat-title>");
  if (
    open !== -1 &&
    atLineStart(content, open) &&
    content.length - open <= 180 &&
    !content.slice(open).includes("</chat-title>")
  ) {
    return content.slice(0, open).trimEnd();
  }
  // A partial opening tag mid-stream, e.g. "…answer.\n<chat-ti".
  const tail = content.slice(-13);
  const lt = tail.lastIndexOf("<");
  if (lt !== -1 && "<chat-title>".startsWith(tail.slice(lt))) {
    const abs = content.length - (tail.length - lt);
    if (atLineStart(content, abs)) return content.slice(0, abs).trimEnd();
  }
  return content;
}

/**
 * Store attachment bytes server-side and return lightweight references.
 * Never keep base64 in client state — that is what bloated the state blob.
 * On failure the reference is returned without an id and a warning logged,
 * so the caller can still show the attachment name rather than failing silently.
 */
export async function uploadAttachments(attachments: Attachment[]): Promise<Attachment[]> {
  const refs: Attachment[] = [];
  for (const a of attachments) {
    const base: Attachment = { name: a.name, type: a.type, size: a.size };
    const res = await api.post<{ id: string }>("/api/attachments", {
      name: a.name,
      type: a.type,
      dataUrl: a.dataUrl,
    });
    if (res.ok) base.id = res.data.id;
    else console.warn(`[attachments] upload failed for "${a.name}": ${res.error}`);
    refs.push(base);
  }
  return refs;
}

/** Metadata-only copies for display (no bytes, no server ids yet). */
export const attachmentMeta = (attachments?: Attachment[]): Attachment[] | undefined =>
  attachments?.length
    ? attachments.map((a) => ({ name: a.name, type: a.type, size: a.size }))
    : undefined;

/** Human-readable message for a failed turn. */
export const turnErrorMessage = (err: unknown): string =>
  `⚠️ ${err instanceof Error ? err.message : "The reply failed."}`;

/**
 * In-flight turns, keyed by chat/conversation id, so any component can stop
 * the run it can see. Module-level (not React state) because the stream must
 * survive navigation between pages.
 */
export const abortControllers = new Map<string, AbortController>();

/** Stop the in-flight turn for a chat. Returns false if nothing was running. */
export function stopTurn(id: string): boolean {
  const c = abortControllers.get(id);
  if (!c) return false;
  c.abort();
  abortControllers.delete(id);
  return true;
}
