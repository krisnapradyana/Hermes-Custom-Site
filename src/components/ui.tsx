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
/** UI-refresh: the screen header is a floating glass capsule aligned to the
 *  content column — no more edge-to-edge bar slicing the gradient. */
export const ScreenHeader = ({ left, right }: { left: ReactNode; right?: ReactNode }) => (
  <div className="px-4 pt-3 pb-1 z-10">
    <header className="glass mx-auto max-w-3xl rounded-2xl flex items-center justify-between px-4 py-2">
      <div className="flex items-center gap-2.5 min-w-0">{left}</div>
      {right && <div className="flex items-center gap-1 min-w-0 ml-3 shrink-0">{right}</div>}
    </header>
  </div>
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
