export function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}


/**
 * Turn a cron expression into a plain sentence. Hermes evaluates cron in
 * UTC, so numeric times are converted to the BROWSER'S local time for
 * display (with weekday names shifted when the conversion crosses midnight).
 * Falls back to the raw expression.
 */
export function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, , dow] = parts;

  const isNum = (v: string) => /^\d+$/.test(v);
  const pad = (n: number) => String(n).padStart(2, "0");
  // Reference instant: Sunday 2026-01-04 UTC + dow offset keeps weekday math exact.
  const localAt = (d: number) => new Date(Date.UTC(2026, 0, 4 + d, Number(hour), Number(min)));
  const localTime = (d = 0) => {
    const t = localAt(d);
    return `${pad(t.getHours())}:${pad(t.getMinutes())}`;
  };

  if (isNum(min) && isNum(hour)) {
    if (dom === "*" && dow === "*") return `Every day at ${localTime()}`;
    if (dom === "*" && (dow === "1-5" || dow === "0-4" || dow === "2-6"))
      return `Weekdays at ${localTime()}`;
    if (dom === "*" && isNum(dow)) {
      const t = localAt(Number(dow));
      const name = t.toLocaleDateString("en-US", { weekday: "long" });
      return `Every ${name} at ${localTime(Number(dow))}`;
    }
    if (isNum(dom) && dow === "*") return `Monthly around day ${dom} at ${localTime()}`;
  }
  if (min === "0" && hour === "*") return "Every hour";
  if (min.startsWith("*/")) return `Every ${min.slice(2)} minutes`;
  if (hour.startsWith("*/") && (min === "0" || isNum(min))) return `Every ${hour.slice(2)} hours`;
  return `${expr} (UTC)`;
}

export type Frequency = "daily" | "weekdays" | "weekly" | "monthly" | "hourly";

/**
 * Build a cron expression from human-friendly LOCAL inputs. Hermes runs
 * cron in UTC, so the picked local time converts here — including the
 * weekday/day-of-month shift when the conversion crosses midnight (WITA is
 * UTC+8: any local time before 08:00 lands on the previous UTC day).
 */
export function buildCron(
  freq: Frequency,
  time: string, // "HH:MM" local
  weekday: number, // 0-6, Sunday = 0, local
  dayOfMonth: number // 1-28, local
): string {
  const [h, m] = time.split(":").map((v) => parseInt(v, 10) || 0);
  // Local wall-clock today at h:m → the same instant's UTC fields.
  const local = new Date();
  local.setHours(h, m, 0, 0);
  const um = local.getUTCMinutes();
  const uh = local.getUTCHours();
  // -1 / 0 / +1: how the date shifted crossing to UTC.
  const dayShift = Math.sign(local.getUTCDate() - local.getDate()) *
    (Math.abs(local.getUTCDate() - local.getDate()) > 1 ? -1 : 1);

  switch (freq) {
    case "daily":
      return `${um} ${uh} * * *`;
    case "weekdays": {
      if (dayShift === 0) return `${um} ${uh} * * 1-5`;
      // Local Mon–Fri = UTC Sun–Thu (shift −1) or Tue–Sat (+1).
      return dayShift < 0 ? `${um} ${uh} * * 0-4` : `${um} ${uh} * * 2-6`;
    }
    case "weekly": {
      const udow = (weekday + dayShift + 7) % 7;
      return `${um} ${uh} * * ${udow}`;
    }
    case "monthly": {
      // Anchor to the next local occurrence and read its UTC day-of-month.
      const d = new Date();
      d.setDate(dayOfMonth);
      d.setHours(h, m, 0, 0);
      if (d.getTime() < Date.now()) d.setMonth(d.getMonth() + 1);
      return `${um} ${uh} ${d.getUTCDate()} * *`;
    }
    case "hourly":
      return `0 * * * *`;
  }
}
