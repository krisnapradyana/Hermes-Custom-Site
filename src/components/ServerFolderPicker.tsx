"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Folder, ChevronRight, HardDrive, Check, X } from "lucide-react";
import { FolderNav } from "@/components/FolderNav";
import { SortMenu, SortMode, loadSort, compareEntries } from "@/components/SortMenu";
import { api } from "@/lib/api";

/**
 * Browses the server's Drive mount (via /api/fs/browse) so the user can pick
 * a working folder from the real shared Drive. Returns the chosen absolute
 * path (e.g. /gdrive/2024 PROJECTS/RND).
 */

interface BrowseFolder {
  name: string;
  mtime?: string;
}

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
  const [folders, setFolders] = useState<BrowseFolder[] | null>(null);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<SortMode>("name-asc");

  useEffect(() => {
    setSort(loadSort("folder-picker"));
  }, []);

  const load = useCallback(async (s: string) => {
    setFolders(null);
    setError("");
    const res = await api.get<{ base: string; path: string; folders: BrowseFolder[] }>(
      `/api/fs/browse?sub=${encodeURIComponent(s)}`
    );
    if (!res.ok) {
      setError(res.error);
      setFolders([]);
      return;
    }
    setBase(res.data.base);
    setCurrent(res.data.path);
    setFolders(res.data.folders);
  }, []);

  useEffect(() => {
    load(sub);
  }, [sub, load]);

  const sorted = useMemo(
    () => (folders ? [...folders].sort((a, b) => compareEntries(sort, a, b)) : null),
    [folders, sort]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onCancel}>
      <div
        className="w-full max-w-2xl rounded-2xl border border-line bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <HardDrive size={16} className="text-accent" />
          <h2 className="text-[15px] font-semibold flex-1">Choose a project folder</h2>
          <SortMenu value={sort} onChange={setSort} storageKey="folder-picker" />
        </div>

        {/* Nav toolbar (Root / Up + breadcrumb) */}
        <div className="rounded-t-lg border border-line overflow-hidden">
          <FolderNav sub={sub} onNavigate={setSub} rootLabel={base} />
        </div>

        {/* Folder list */}
        <div className="h-[22rem] overflow-y-auto rounded-b-lg border border-t-0 border-line">
          {!sorted && <p className="px-3 py-2 text-[12px] text-ink-faint">Loading…</p>}
          {error && <p className="px-3 py-2 text-[12px] text-red-500">{error}</p>}
          {sorted?.map((f) => (
            <button
              key={f.name}
              onClick={() => setSub(sub ? `${sub}/${f.name}` : f.name)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-parchment-dark text-left text-[13px]"
            >
              <Folder size={14} className="text-accent shrink-0" />
              <span className="truncate flex-1">{f.name}</span>
              {f.mtime && (
                <span className="text-[11px] text-ink-faint shrink-0">
                  {new Date(f.mtime).toLocaleDateString()}
                </span>
              )}
              <ChevronRight size={12} className="text-ink-faint" />
            </button>
          ))}
          {sorted && sorted.length === 0 && !error && (
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
