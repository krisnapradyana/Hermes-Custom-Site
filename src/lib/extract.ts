import { Artifact, ArtifactKind, Attachment } from "./types";

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

const TEXT_FILE_RE = /\.(md|txt|json|csv|tsv|ts|tsx|js|jsx|py|html|css|yml|yaml|xml|sh|sql|log|toml|ini)$/i;
const CODE_FILE_RE = /\.(ts|tsx|js|jsx|py|sh|sql|css|yml|yaml|xml|toml)$/i;

function decodeDataUrlText(dataUrl: string): string {
  try {
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

/** Turn user-uploaded attachments into artifacts so they appear in the history. */
export function artifactsFromAttachments(
  attachments: Attachment[],
  chatId: string,
  makeId: () => string
): Artifact[] {
  const now = new Date().toISOString();
  return attachments.map((a) => {
    const isImage = a.type.startsWith("image/");
    const isText =
      a.type.startsWith("text/") || a.type === "application/json" || TEXT_FILE_RE.test(a.name);
    const isHtml = a.type === "text/html" || /\.html?$/i.test(a.name);

    let kind: ArtifactKind;
    let content: string;
    if (isImage) {
      kind = "image";
      content = a.dataUrl;
    } else if (isHtml) {
      kind = "html";
      content = decodeDataUrlText(a.dataUrl) || a.dataUrl;
    } else if (isText) {
      kind = CODE_FILE_RE.test(a.name) ? "code" : "document";
      content = decodeDataUrlText(a.dataUrl) || a.dataUrl;
    } else {
      kind = "file";
      content = a.dataUrl; // keep as data URL so it stays downloadable
    }

    return {
      id: makeId(),
      title: a.name,
      kind,
      language: CODE_FILE_RE.test(a.name) ? a.name.split(".").pop()?.toLowerCase() : undefined,
      content,
      chatId,
      createdAt: now,
      updatedAt: now,
    };
  });
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
