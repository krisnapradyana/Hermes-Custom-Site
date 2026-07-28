"use client";

import { Home, ArrowUp, ChevronRight } from "lucide-react";

/**
 * Shared folder navigation toolbar (Root / Up + clickable breadcrumb).
 * Used by both the workspace panel and the project folder picker so they
 * look and behave identically.
 */
export function FolderNav({
  sub,
  onNavigate,
  rootLabel = "root",
}: {
  sub: string;
  onNavigate: (sub: string) => void;
  rootLabel?: string;
}) {
  const crumbs = sub ? sub.split("/").filter(Boolean) : [];
  const parent = crumbs.slice(0, -1).join("/");
  const atRoot = crumbs.length === 0;

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-line bg-parchment-dark/40">
      <button
        onClick={() => onNavigate("")}
        disabled={atRoot}
        title="Root"
        className="p-1.5 rounded-md text-ink-soft hover:bg-parchment-dark hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <Home size={13} />
      </button>
      <button
        onClick={() => onNavigate(parent)}
        disabled={atRoot}
        title="Up one level"
        className="p-1.5 rounded-md text-ink-soft hover:bg-parchment-dark hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <ArrowUp size={13} />
      </button>

      <div className="flex items-center flex-wrap gap-0.5 min-w-0 pl-1 text-[11px] text-ink-faint">
        <button onClick={() => onNavigate("")} className="hover:text-ink shrink-0">
          {rootLabel}
        </button>
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-0.5 min-w-0">
            <ChevronRight size={10} className="shrink-0" />
            <button
              onClick={() => onNavigate(crumbs.slice(0, i + 1).join("/"))}
              className={`hover:text-ink truncate ${i === crumbs.length - 1 ? "text-ink font-medium" : ""}`}
            >
              {c}
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
