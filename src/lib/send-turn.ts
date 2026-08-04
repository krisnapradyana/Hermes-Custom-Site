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
export const PRIVATE_OUTPUT_DIR = "/opt/data/outputs";

/**
 * Build the system context for a turn. Identical for every send path.
 * @param project    the chat's project, if any
 * @param mentions   files the user referenced with "@" (project-relative)
 */
export function buildAgentContext(project?: Project, mentions?: string[]): string {
  if (project?.workingFolder) {
    const mentionNote =
      mentions?.length
        ? `\nThe user referenced these project files — read them from disk:\n` +
          mentions.map((m) => `- ${project.workingFolder}/${m}`).join("\n")
        : "";
    return (
      `The user is working in project "${project.name}". Working folder: ` +
      `${project.workingFolder} — it is the team's shared Drive, mounted on this ` +
      `machine. Read project files from there and save all generated files there. ` +
      `${REPORT_PATH} ${SAFETY_RULES}${mentionNote}`
    );
  }
  return (
    `This is a private chat with no project folder. Save any files you generate ` +
    `in ${PRIVATE_OUTPUT_DIR}/ (create the folder if needed), not in the data root. ` +
    `${REPORT_PATH} ${SAFETY_RULES}`
  );
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
