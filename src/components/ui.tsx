"use client";

import { ReactNode } from "react";

/**
 * Shared UI primitives. Each of these existed as a copy-pasted Tailwind class
 * string in 4–26 places; a single definition keeps the theme consistent and
 * means a visual tweak happens once.
 */

/** Square icon button used across every header and panel (was 26 copies). */
export function IconButton({
  onClick,
  title,
  children,
  active,
  danger,
  className = "",
}: {
  onClick?: () => void;
  title: string;
  children: ReactNode;
  active?: boolean;
  danger?: boolean;
  className?: string;
}) {
  const tone = active
    ? "text-accent"
    : danger
      ? "text-ink-soft hover:text-red-600"
      : "text-ink-soft hover:text-ink";
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`p-2 rounded-lg hover:bg-parchment-dark transition-colors ${tone} ${className}`}
    >
      {children}
    </button>
  );
}

/** Full-height centred message for empty / not-found states (was 5 copies). */
export const EmptyState = ({ children }: { children: ReactNode }) => (
  <div className="flex h-full items-center justify-center text-ink-faint text-sm">{children}</div>
);

/** Sticky header bar shared by the chat and conversation screens. */
export const ScreenHeader = ({ left, right }: { left: ReactNode; right?: ReactNode }) => (
  <header className="flex items-center justify-between border-b border-line bg-parchment/80 backdrop-blur px-6 py-3 sticky top-0 z-10">
    <div className="flex items-center gap-2.5 min-w-0">{left}</div>
    {right && <div className="flex items-center gap-1 min-w-0 ml-3">{right}</div>}
  </header>
);

/**
 * Floating side panel (workspace / artifact panes) — a detached card with
 * rounded corners and a shadow, Claude-style, instead of a flush column.
 * The outer div carries the resizable width; the inner card fills it.
 */
export const SidePanel = ({ width, children }: { width: number; children: ReactNode }) => (
  <div className="shrink-0 py-3 pr-3" style={{ width }}>
    <div className="h-full rounded-2xl border border-line bg-card shadow-lg flex flex-col overflow-hidden">
      {children}
    </div>
  </div>
);
