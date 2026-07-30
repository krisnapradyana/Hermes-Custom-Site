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

const DAY_NAMES: Record<string, string> = {
  "0": "Sunday",
  "1": "Monday",
  "2": "Tuesday",
  "3": "Wednesday",
  "4": "Thursday",
  "5": "Friday",
  "6": "Saturday",
  "7": "Sunday",
};

/** Turn a cron expression into a plain sentence (falls back to the raw expression). */
export function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, , dow] = parts;

  const isNum = (v: string) => /^\d+$/.test(v);
  const time = () => `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;

  if (isNum(min) && isNum(hour)) {
    if (dom === "*" && dow === "*") return `Every day at ${time()}`;
    if (dom === "*" && dow === "1-5") return `Weekdays at ${time()}`;
    if (dom === "*" && DAY_NAMES[dow]) return `Every ${DAY_NAMES[dow]} at ${time()}`;
    if (isNum(dom) && dow === "*") return `Monthly on day ${dom} at ${time()}`;
  }
  if (min === "0" && hour === "*") return "Every hour";
  if (min.startsWith("*/")) return `Every ${min.slice(2)} minutes`;
  if (hour.startsWith("*/") && (min === "0" || isNum(min)))
    return `Every ${hour.slice(2)} hours`;
  return expr;
}

export type Frequency = "daily" | "weekdays" | "weekly" | "monthly" | "hourly";

/** Build a cron expression from human-friendly inputs. */
export function buildCron(
  freq: Frequency,
  time: string, // "HH:MM"
  weekday: number, // 0-6, Sunday = 0
  dayOfMonth: number // 1-28
): string {
  const [h, m] = time.split(":").map((v) => parseInt(v, 10) || 0);
  switch (freq) {
    case "daily":
      return `${m} ${h} * * *`;
    case "weekdays":
      return `${m} ${h} * * 1-5`;
    case "weekly":
      return `${m} ${h} * * ${weekday}`;
    case "monthly":
      return `${m} ${h} ${dayOfMonth} * *`;
    case "hourly":
      return `0 * * * *`;
  }
}
