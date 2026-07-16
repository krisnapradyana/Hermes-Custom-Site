export type Role = "user" | "assistant";

export interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: string; // ISO
  artifactId?: string;
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
}

export type ArtifactKind = "document" | "code" | "html" | "diagram";

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
