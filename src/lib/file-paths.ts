/**
 * Detection of server file paths in agent replies — shared by the chat
 * download chips (MessageList) and the project Artifacts collector, so a
 * generated document shows up in both places from the same mention.
 */

export const FILE_PATH_RE =
  /(?:^|[\s"'`(])((?:\/gdrive|\/opt\/data|\/workspace)\/[^\s"'`()<>]*\.[A-Za-z0-9]{1,8})/g;

/** Hermes' own internals live in /opt/data — never surface those as files. */
export const INTERNAL_RE =
  /^\/opt\/data\/(auth\.json|auth\.lock|custom-\.env|cache\/|audio_cache\/|bin\/|backups\/|memories\/|custom-config\.yaml)/;

export function extractFilePaths(text: string, max = 8): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(FILE_PATH_RE)) {
    const p = m[1].replace(/[.,;:!?]+$/, ""); // trailing punctuation is sentence, not path
    if (!INTERNAL_RE.test(p)) found.add(p);
  }
  return [...found].slice(0, max);
}

const DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?|md|txt|csv)$/i;
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;

/** Artifact kind for a generated file, by extension. */
export function kindForPath(p: string): "document" | "image" | "file" {
  if (DOC_EXT.test(p)) return "document";
  if (IMG_EXT.test(p)) return "image";
  return "file";
}
