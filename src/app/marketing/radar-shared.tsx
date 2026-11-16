/** Types + small display helpers shared by the radar list and the project page. */

export type Nda = "ask" | "ok" | "no";

export interface RadarCard {
  id: string;
  title: string;
  format: string;
  stage: string;
  owner: string;
  reviewer: string;
  due: string | null;
  channel: string;
}

export interface SourceLink {
  id: string;
  label: string;
  url: string;
}

export interface Item {
  id: string;
  source: "tracker" | "manual";
  name: string;
  sub: string;
  color: string;
  deliveredAt: string | null;
  pub: Record<string, boolean>;
  nda: Nda;
  ndaNote: string;
  angle: string;
  formats: string[];
  summary: string;
  challenge: string;
  contribution: string;
  services: string[];
  links: SourceLink[];
  skip: string[];
  excluded?: boolean;
  updatedBy?: string;
  updatedAt?: string;
  /** Pipeline cards about this project. */
  cards: RadarCard[];
}

export type Patch = (id: string, change: Partial<Item>) => void;

export type Status = "ready" | "planned" | "waiting" | "ask" | "restricted";

export function statusOf(it: Item, channels: string[]): Status {
  if (it.nda === "no") return "restricted";
  if (it.nda === "ask") return "ask";
  if (!channels.some((c) => it.pub[c])) return "waiting";
  return it.formats.length || it.cards.length ? "planned" : "ready";
}

export const STATUS: Record<Status, { label: string; cls: string }> = {
  ready: { label: "Ready to plan", cls: "border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  planned: { label: "Planned", cls: "border-accent/50 bg-accent-soft text-accent" },
  waiting: { label: "Wait for client", cls: "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  ask: { label: "Ask producer", cls: "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  restricted: { label: "Restricted", cls: "border-red-500/50 bg-red-500/15 text-red-700 dark:text-red-300" },
};

export const fmtDate = (d: string | null) =>
  d
    ? new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "date unknown";

export const chip = "rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap";
export const inputCls =
  "w-full rounded-xl border border-line/60 bg-card/70 px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent";

export function Head({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 mt-5 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
      {children}
    </div>
  );
}

/** The three-way NDA switch — used in the radar pane and on the project page. */
export function NdaSwitch({ value, onChange }: { value: Nda; onChange: (v: Nda) => void }) {
  return (
    <div className="flex gap-1.5">
      {(
        [
          ["ask", "Not checked"],
          ["ok", "Cleared"],
          ["no", "Restricted"],
        ] as [Nda, string][]
      ).map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`flex-1 rounded-lg border px-2 py-1.5 text-[13px] transition-colors ${
            value === v
              ? v === "ok"
                ? "border-emerald-500/50 bg-emerald-500/15 font-medium text-emerald-700 dark:text-emerald-300"
                : v === "no"
                  ? "border-red-500/50 bg-red-500/15 font-medium text-red-700 dark:text-red-300"
                  : "border-amber-500/50 bg-amber-500/15 font-medium text-amber-700 dark:text-amber-300"
              : "border-line/60 text-ink-soft hover:bg-parchment-dark/50"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Tick boxes for where the client has published. */
export function ChannelTicks({
  channels,
  pub,
  onChange,
}: {
  channels: string[];
  pub: Record<string, boolean>;
  onChange: (pub: Record<string, boolean>) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {channels.map((c) => (
        <label
          key={c}
          className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] transition-colors ${
            pub[c]
              ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
              : "border-line/60 text-ink-soft hover:bg-parchment-dark/50"
          }`}
        >
          <input
            type="checkbox"
            checked={!!pub[c]}
            onChange={(e) => onChange({ ...pub, [c]: e.target.checked })}
            className="accent-emerald-600"
          />
          {c}
        </label>
      ))}
    </div>
  );
}
