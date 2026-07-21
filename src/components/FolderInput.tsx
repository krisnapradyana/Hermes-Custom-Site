"use client";

import { useEffect, useRef } from "react";
import { FolderCheck, FolderX, HardDrive, FolderOpen } from "lucide-react";

/**
 * Folder path input with a native "Select folder" dialog.
 *
 * Browsers deliberately never expose a folder's absolute path to JS, so the
 * picker returns only the folder NAME. We prefix it with the shared Drive
 * base (NEXT_PUBLIC_DRIVE_BASE, default "G:\My Drive\") to produce a full
 * path artists can accept as-is or tweak. The field stays editable.
 */

const DRIVE_BASE = (process.env.NEXT_PUBLIC_DRIVE_BASE ?? "G:\\My Drive\\").replace(/[\\/]*$/, "\\");

const WINDOWS = /^[A-Za-z]:[\\/].+/;
const UNC = /^\\\\[^\\]+\\.+/;
const POSIX = /^\/.+/;
const looksValid = (p: string) => {
  const v = p.trim();
  return WINDOWS.test(v) || UNC.test(v) || POSIX.test(v);
};

// Minimal typing for the File System Access API (not in all TS libs).
type DirHandle = { name: string };
type PickerWindow = Window & {
  showDirectoryPicker?: () => Promise<DirHandle>;
};

export function FolderInput({
  value,
  onChange,
  onStatus,
  onHandle,
  placeholder,
  label,
  optional,
}: {
  value: string;
  onChange: (v: string) => void;
  onStatus?: (ok: boolean) => void;
  /** Fires with the picked directory handle (for persisting access). */
  onHandle?: (handle: unknown) => void;
  placeholder?: string;
  label?: string;
  optional?: boolean;
}) {
  const trimmed = value.trim();
  const empty = trimmed === "";
  const ok = empty ? !!optional : looksValid(trimmed);
  const fallbackRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onStatus?.(ok);
  }, [ok, onStatus]);

  const applyName = (name: string) => {
    if (name) onChange(DRIVE_BASE + name);
  };

  const pick = async () => {
    const w = window as PickerWindow;
    if (w.showDirectoryPicker) {
      try {
        const handle = await w.showDirectoryPicker();
        applyName(handle.name);
        onHandle?.(handle);
      } catch {
        /* user cancelled */
      }
    } else {
      // Older browsers: hidden webkitdirectory input.
      fallbackRef.current?.click();
    }
  };

  return (
    <div>
      {label && (
        <p className="text-sm font-medium mb-1.5">
          {label}
          {optional && <span className="text-ink-faint font-normal"> (optional)</span>}
        </p>
      )}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder ?? `${DRIVE_BASE}Projects\\my-project`}
            spellCheck={false}
            className="w-full rounded-lg border border-line bg-transparent px-3 py-2 pr-9 text-sm font-mono outline-none focus:border-ink-faint"
          />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
            {!empty && ok && <FolderCheck size={14} className="text-green-600" />}
            {!empty && !ok && <FolderX size={14} className="text-red-500" />}
          </span>
        </div>
        <button
          type="button"
          onClick={pick}
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm text-ink-soft hover:border-ink-faint hover:text-ink shrink-0"
          title="Browse for a folder"
        >
          <FolderOpen size={14} />
          Select folder
        </button>
      </div>

      {/* Fallback picker for browsers without the File System Access API. */}
      <input
        ref={fallbackRef}
        type="file"
        // @ts-expect-error non-standard attributes
        webkitdirectory=""
        directory=""
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) applyName((f.webkitRelativePath || f.name).split("/")[0]);
          e.target.value = "";
        }}
      />

      {!empty && !ok && (
        <p className="mt-1 text-[11px] text-red-500">
          Enter a full path, e.g. {DRIVE_BASE}… or /workspace/…
        </p>
      )}
      <p className="mt-1 flex items-center gap-1 text-[11px] text-ink-faint">
        <HardDrive size={11} />
        Pick your project folder — it&apos;s assumed to be under {DRIVE_BASE.replace(/\\$/, "")}. Edit if it lives elsewhere.
      </p>
    </div>
  );
}
