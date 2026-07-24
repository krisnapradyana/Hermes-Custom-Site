"use client";

import { useCallback, useEffect, useState } from "react";
import { Folder, ChevronRight, HardDrive, Check, X } from "lucide-react";

/**
 * Browses the server's Drive mount (via /api/fs/browse) so the user can pick
 * a working folder from the real shared Drive. Returns the chosen absolute
 * path (e.g. /gdrive/2024 PROJECTS/RND).
 */
export function ServerFolderPicker({
  onPick,
  onCancel,
}: {
  onPick: (absPath: string) => void;
  onCancel: () => void;
}) {
  const [sub, setSub] = useState("");
  const [base, setBase] = useState("/gdrive");
  const [current, setCurrent] = useState("/gdrive");
  const [folders, setFolders] = useState<string[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async (s: string) => {
    setFolders(null);
    setError("");
    try {
      const res = await fetch(`/api/fs/browse?sub=${encodeURIComponent(s)}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not read folder");
        setFolders([]);
      } else {
        setBase(data.base);
        setCurrent(data.path);
        setFolders(data.folders);
      }
    } catch {
      setError("Could not reach the server");
      setFolders([]);
    }
  }, []);

  useEffect(() => {
    load(sub);
  }, [sub, load]);

  const crumbs = sub ? sub.split("/").filter(Boolean) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onCancel}>
      <div
        className="w-full max-w-lg rounded-2xl border border-line bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <HardDrive size={16} className="text-accent" />
          <h2 className="text-[15px] font-semibold">Choose a project folder</h2>
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center flex-wrap gap-0.5 mb-2 text-[12px] text-ink-faint">
          <button onClick={() => setSub("")} className="hover:text-ink">
            {base}
          </button>
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-0.5">
              <ChevronRight size={11} />
              <button onClick={() => setSub(crumbs.slice(0, i + 1).join("/"))} className="hover:text-ink">
                {c}
              </button>
            </span>
          ))}
        </div>

        {/* Folder list */}
        <div className="h-64 overflow-y-auto rounded-lg border border-line">
          {!folders && <p className="px-3 py-2 text-[12px] text-ink-faint">Loading…</p>}
          {error && <p className="px-3 py-2 text-[12px] text-red-500">{error}</p>}
          {folders?.map((f) => (
            <button
              key={f}
              onClick={() => setSub(sub ? `${sub}/${f}` : f)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-parchment-dark text-left text-[13px]"
            >
              <Folder size={14} className="text-accent shrink-0" />
              <span className="truncate flex-1">{f}</span>
              <ChevronRight size={12} className="text-ink-faint" />
            </button>
          ))}
          {folders && folders.length === 0 && !error && (
            <p className="px-3 py-2 text-[12px] text-ink-faint">No sub-folders here.</p>
          )}
        </div>

        <p className="mt-2 text-[11px] text-ink-faint font-mono truncate">Selected: {current}</p>

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onCancel} className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm text-ink-soft hover:bg-parchment-dark">
            <X size={14} /> Cancel
          </button>
          <button
            onClick={() => onPick(current)}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm text-white hover:bg-accent-hover"
          >
            <Check size={14} /> Use this folder
          </button>
        </div>
      </div>
    </div>
  );
}
