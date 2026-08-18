export type Role = "user" | "assistant";

export interface Attachment {
  name: string;
  type: string; // MIME type
  size: number; // bytes
  /** Transient — present only at upload time, never persisted. */
  dataUrl?: string;
  /** Server reference for persisted attachments (bytes stored off the state blob). */
  id?: string;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: string; // ISO
  artifactId?: string;
  attachments?: Attachment[];
  /** Reasoning + tool activity streamed before the answer (collapsible in UI). */
  thinking?: string;
  /** Live one-line summary while working (e.g. "Running a command…"). */
  status?: string;
  /** ms since the last stream activity — UI flags long quiet stretches. */
  idleMs?: number;
  /** Delivery/completion state of an assistant turn. */
  state?: "working" | "done" | "failed";
  /** The user text to resend when retrying a failed turn. */
  retryOf?: string;
  /** Attachments to resend with a retry (stored server-side, fetched by id). */
  retryAttachments?: Attachment[];
}

export interface Chat {
  id: string;
  title: string;
  pinned: boolean;
  projectId?: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  /**
   * Client-only: true once this chat's messages have been fetched from
   * /api/chats/<id>. Chat lists load metadata only, so `messages` is empty
   * until a chat is opened — never persist while this is false or the empty
   * array would overwrite real history on the server.
   */
  loaded?: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  color: string; // tailwind-safe hex
  createdAt: string;
  /** Absolute path on this machine — required before working in the project. */
  workingFolder?: string;
  /** Optional Google Drive folder (mounted as a drive, e.g. "G:\\My Drive\\..."). */
  driveFolder?: string;
  /** Slack channel for project sharing (step 3). */
  slackChannel?: string;
  /** Who created the project (shown in the shared list). */
  createdBy?: { name: string; slackId?: string };
  /** Planned schedule (ISO dates, YYYY-MM-DD). */
  startDate?: string;
  deadline?: string;
}

/** Shared, project-scoped conversation (readable by all; only creator replies). */
export interface ConversationMeta {
  id: string;
  projectId: string;
  title: string;
  createdBy?: { name: string; slackId?: string };
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}
export interface Conversation extends ConversationMeta {
  messages: Message[];
}

export type ArtifactKind = "document" | "code" | "html" | "diagram" | "image" | "file";

export interface Artifact {
  id: string;
  title: string;
  kind: ArtifactKind;
  language?: string;
  content: string;
  chatId?: string;
  createdAt: string;
  updatedAt: string;
  /**
   * For artifacts that are FILES the agent generated on the server (Drive or
   * its output dir): the absolute server path. Preview/download then go
   * through /api/fs, not `content`.
   */
  path?: string;
}
