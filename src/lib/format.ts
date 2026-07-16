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

export function describeCron(expr: string): string {
  const presets: Record<string, string> = {
    "0 7 * * 1": "Mondays at 07:00",
    "30 9 * * 1-5": "Weekdays at 09:30",
    "0 6 * * 0": "Sundays at 06:00",
    "0 * * * *": "Every hour",
    "0 0 * * *": "Daily at midnight",
  };
  return presets[expr] ?? expr;
}
