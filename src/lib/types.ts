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
}

export interface Chat {
  id: string;
  title: string;
  pinned: boolean;
  projectId?: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
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
}

export interface CronJob {
  id: string;
  name: string;
  schedule: string; // cron expression
  prompt: string;
  enabled: boolean;
  lastRunAt?: string;
  lastStatus?: "success" | "failed" | "running";
  nextRunAt?: string;
  target: "chat" | "slack";
}
