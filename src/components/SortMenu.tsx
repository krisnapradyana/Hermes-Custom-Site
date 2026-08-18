"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  ClockArrowDown,
  ClockArrowUp,
  ArrowUpDown,
  Check,
} from "lucide-react";

/**
 * Shared folder/file sort control — used by the project-folder picker and the
 * workspace panel so both sort the same way. The choice is remembered per
 * surface (storageKey) in localStorage.
 */

export type SortMode = "name-asc" | "name-desc" | "date-desc" | "date-asc";

const OPTIONS: { id: SortMode; label: string; icon: React.ReactNode }[] = [
  { id: "name-asc", label: "Name A → Z", icon: <ArrowDownAZ size={13} /> },
  { id: "name-desc", label: "Name Z → A", icon: <ArrowUpAZ size={13} /> },
  { id: "date-desc", label: "Newest first", icon: <ClockArrowDown size={13} /> },
  { id: "date-asc", label: "Oldest first", icon: <ClockArrowUp size={13} /> },
];

export function loadSort(storageKey: string): SortMode {
  try {
    const v = localStorage.getItem(`hermes-sort-${storageKey}`);
    if (v && OPTIONS.some((o) => o.id === v)) return v as SortMode;
  } catch {}
  return "name-asc";
}

/** Comparator for {name, mtime?} items. Callers keep dirs-first themselves. */
export function compareEntries(
  mode: SortMode,
  a: { name: string; mtime?: string },
  b: { name: string; mtime?: string }
): number {
  switch (mode) {
    case "name-asc":
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    case "name-desc":
      return b.name.localeCompare(a.name, undefined, { numeric: true });
    case "date-desc":
      return (b.mtime ?? "").localeCompare(a.mtime ?? "");
    case "date-asc":
      return (a.mtime ?? "").localeCompare(b.mtime ?? "");
  }
}

export function SortMenu({
  value,
  onChange,
  storageKey,
}: {
  value: SortMode;
  onChange: (m: SortMode) => void;
  storageKey: string;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = OPTIONS.find((o) => o.id === value) ?? OPTIONS[0];

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-colors ${
          open
            ? "bg-parchment-dark text-ink"
            : "text-ink-faint hover:text-ink hover:bg-parchment-dark"
        }`}
        title={`Sort: ${current.label}`}
      >
        <ArrowUpDown size={12} />
        <span className="hidden sm:inline">{current.label}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-xl border border-line bg-card p-1.5 shadow-lg">
          {OPTIONS.map((o) => (
            <button
              key={o.id}
              onClick={() => {
                onChange(o.id);
                try {
                  localStorage.setItem(`hermes-sort-${storageKey}`, o.id);
                } catch {}
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] hover:bg-parchment-dark"
            >
              <span className="text-ink-faint">{o.icon}</span>
              <span className={`flex-1 ${o.id === value ? "font-medium" : ""}`}>{o.label}</span>
              {o.id === value && <Check size={12} className="text-accent shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
