import { Artifact, ArtifactKind } from "./types";

/**
 * Real-case artifact extraction: when Hermes replies with fenced code
 * blocks, promote substantial ones (>= 4 lines) to artifacts so they
 * appear in the Artifacts history.
 */

const FENCE_RE = /```(\w*)\n([\s\S]*?)```/g;

function kindFor(lang: string): ArtifactKind {
  if (lang === "html") return "html";
  if (lang === "mermaid") return "diagram";
  if (lang === "markdown" || lang === "md") return "document";
  return "code";
}

function titleFor(code: string, lang: string, chatTitle: string): string {
  // Try a filename-looking comment on the first line, e.g. "// store.ts"
  const first = code.split("\n", 1)[0].trim();
  const m = first.match(/^(?:\/\/|#|<!--)\s*([\w./-]+\.\w{1,5})/);
  if (m) return m[1];
  return `${lang ? lang.toUpperCase() + " — " : ""}${chatTitle}`.slice(0, 60);
}

export function extractArtifacts(
  reply: string,
  chatId: string,
  chatTitle: string,
  makeId: () => string
): Artifact[] {
  const artifacts: Artifact[] = [];
  const now = new Date().toISOString();

  for (const match of reply.matchAll(FENCE_RE)) {
    const lang = (match[1] ?? "").toLowerCase();
    const code = (match[2] ?? "").trim();
    if (code.split("\n").length < 4) continue; // skip trivial snippets

    artifacts.push({
      id: makeId(),
      title: titleFor(code, lang, chatTitle),
      kind: kindFor(lang),
      language: lang || undefined,
      content: code,
      chatId,
      createdAt: now,
      updatedAt: now,
    });
  }

  return artifacts;
}
