export type Role = "user" | "assistant";

export interface Attachment {
  name: string;
  type: string; // MIME type
  size: number; // bytes
  dataUrl: string; // data:<mime>;base64,...
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
