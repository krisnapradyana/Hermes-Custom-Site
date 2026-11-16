/** Types + small display helpers shared by the pipeline board and the card panel. */

export const BANK = "Bank";
export const PUBLIC_STAGES = ["Scheduled", "Published"];

export interface CardAsset {
  id: string;
  label: string;
  url: string;
}
export interface CardComment {
  id: string;
  by: string;
  text: string;
  at: string;
  sys?: boolean;
}
export interface Card {
  id: string;
  title: string;
  format: string;
  stage: string;
  projectId?: string;
  owner: string;
  reviewer: string;
  channel: string;
  due?: string;
  brief: string;
  draft: string;
  draftUrl: string;
  publishedUrl: string;
  notes: string;
  assets: CardAsset[];
  comments: CardComment[];
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}
export interface ProjectRef {
  id: string;
  name: string;
  color: string;
  nda: "ask" | "ok" | "no";
  clientPublished: boolean;
}
export interface Board {
  cards: Card[];
  projects: ProjectRef[];
  people: string[];
  stages: string[];
  formats: string[];
  channels: string[];
  me: string;
  isLead: boolean;
}

export const FORMAT_CLS: Record<string, string> = {
  "Landing page": "border-sky-500/50 bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "SEO article": "border-violet-500/50 bg-violet-500/15 text-violet-700 dark:text-violet-300",
  EDM: "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "Social carousel": "border-pink-500/50 bg-pink-500/15 text-pink-700 dark:text-pink-300",
  "Case study": "border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  Portfolio: "border-teal-500/50 bg-teal-500/15 text-teal-700 dark:text-teal-300",
};

/** Which Checker Studio checker fits a card format (others have none yet). */
export const CHECKER_FOR: Record<string, string> = {
  EDM: "edm",
  "SEO article": "seo",
  "Landing page": "landing",
};

export const chip = "rounded-full border px-2 py-0.5 text-[10.5px] font-medium whitespace-nowrap";
export const inputCls =
  "w-full rounded-xl border border-line/60 bg-card/70 px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent";

const todayIso = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local
export const isOverdue = (c: Card) =>
  !!c.due && c.due < todayIso() && c.stage !== "Published" && c.stage !== BANK;
export const fmtDue = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

const AV = ["#4d8dff", "#e0569b", "#2fae7a", "#d99a2b", "#8b6cf0", "#e0664a", "#2aa3b8"];
/** Initial in a coloured circle — colour is stable per name. */
export function Avatar({ name, size = 20 }: { name: string; size?: number }) {
  if (!name) {
    return (
      <span
        title="Unassigned"
        className="inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-line text-ink-faint"
        style={{ width: size, height: size, fontSize: size * 0.5 }}
      >
        ?
      </span>
    );
  }
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      title={name}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.5, background: AV[h % AV.length] }}
    >
      {name[0].toUpperCase()}
    </span>
  );
}
