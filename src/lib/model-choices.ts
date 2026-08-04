/**
 * Model choices offered in the composer dropdown, configurable via env:
 *   HERMES_MODEL_CHOICES="claude-opus-4-6|Opus 4.6 · best,claude-haiku-4-5|Haiku 4.5 · fast"
 * Format: comma-separated `id|label` pairs; first entry is the default.
 * The id travels as the OpenAI `model` field to Hermes, which routes it
 * (or resolves aliases like "opus"/"sonnet") to the actual provider model.
 */

export interface ModelChoice {
  id: string;
  label: string;
}

const DEFAULTS: ModelChoice[] = [
  { id: "claude-opus-4-6", label: "Opus 4.6 · most capable" },
  { id: "claude-sonnet-4-5", label: "Sonnet 4.5 · balanced" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5 · fast & cheap" },
];

export function parseChoices(raw: string | undefined): ModelChoice[] {
  if (!raw?.trim()) return DEFAULTS;
  const parsed = raw
    .split(",")
    .map((pair) => {
      const [id, ...label] = pair.split("|");
      return { id: id?.trim() ?? "", label: label.join("|").trim() || id?.trim() || "" };
    })
    .filter((c) => c.id);
  return parsed.length ? parsed : DEFAULTS;
}

/** Server-side allowlist check for the proxy. */
export function isAllowedModel(id: string): boolean {
  return parseChoices(process.env.HERMES_MODEL_CHOICES).some((c) => c.id === id);
}
