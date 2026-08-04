"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Folder,
  FileText,
  FileCode,
  FileImage,
  File as FileIcon,
  ArrowLeft,
  HardDrive,
  ListChecks,
  RefreshCw,
  Download,
} from "lucide-react";
import { Project } from "@/lib/types";
import { api } from "@/lib/api";
import { renderMarkdown, parseChecklist, ChecklistProgress } from "@/lib/markdown";
import { FolderNav } from "@/components/FolderNav";
import { SortMenu, SortMode, loadSort, compareEntries } from "@/components/SortMenu";

/**
 * Reads the project's working folder from the SERVER (the rclone Drive
 * mount) via /api/fs — reliable and identical for every user, no browser
 * folder-permission dance.
 */

interface Entry {
  name: string;
  isDir: boolean;
  size?: number;
  mtime?: string;
}
interface FileData {
  kind: "image" | "markdown" | "code" | "text" | "html" | "pdf" | "video" | "audio" | "binary";
  content?: string;
  dataUrl?: string;
  size?: number;
}

const PROGRESS_FILES = ["PROGRESS.md", "TODO.md", "README.md"];
const IMG = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;
const CODE =
  /\.(ts|tsx|js|jsx|py|sh|css|scss|html?|json|ya?ml|sql|rs|go|java|c|cpp|h|rb|php|mjs|cjs|vue|svelte|toml|ini)$/i;
const HTMLRE = /\.html?$/i;
const PDF = /\.pdf$/i;
const VIDEO = /\.(mp4|webm|mov|m4v)$/i;
const AUDIO = /\.(mp3|wav|m4a|flac|ogg)$/i;

function fmtSize(n?: number) {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function iconFor(name: string, isDir: boolean) {
  if (isDir) return <Folder size={14} className="text-accent shrink-0" />;
  if (IMG.test(name)) return <FileImage size={14} className="text-ink-faint shrink-0" />;
  if (CODE.test(name)) return <FileCode size={14} className="text-ink-faint shrink-0" />;
  if (/\.(md|txt|csv|log)$/i.test(name))
    return <FileText size={14} className="text-ink-faint shrink-0" />;
  return <FileIcon size={14} className="text-ink-faint shrink-0" />;
}

export function WorkspacePanel({ project }: { project: Project }) {
  const root = project.workingFolder ?? "";
  const [cwd, setCwd] = useState("");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<(ChecklistProgress & { file: string }) | null>(null);
  const [progressMd, setProgressMd] = useState("");
  const [showProgress, setShowProgress] = useState(false);
  const [selected, setSelected] = useState<{ sub: string; name: string } | null>(null);
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [sort, setSort] = useState<SortMode>("name-asc");
  useEffect(() => {
    setSort(loadSort("workspace"));
  }, []);

  const rawUrl = useCallback(
    (sub: string, download = false) =>
      `/api/fs/raw?root=${encodeURIComponent(root)}&sub=${encodeURIComponent(sub)}${download ? "&download=1" : ""}`,
    [root]
  );

  const inFlight = useRef(false);
  const list = useCallback(
    async (silent = false) => {
      if (!root || inFlight.current) return; // skip overlapping polls
      inFlight.current = true;
      if (!silent) setEntries(null);
      setError("");
      const res = await api.post<{ entries: Entry[] }>("/api/fs/list", { root, sub: cwd });
      if (!res.ok) setError(res.error);
      else setEntries(res.data.entries);
      inFlight.current = false;
    },
    [root, cwd]
  );

  useEffect(() => {
    list();
  }, [list]);

  // Poll so agent-generated files appear on their own — but only while the
  // tab is visible, every 8s, and never overlapping (guarded above).
  useEffect(() => {
    if (!root) return;
    const tick = () => {
      if (document.visibilityState === "visible") list(true);
    };
    const t = setInterval(tick, 8000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [root, list]);

  const loadProgress = useCallback(async () => {
    if (!root) return;
    for (const f of PROGRESS_FILES) {
      const res = await api.post<FileData>("/api/fs/read", { root, sub: f });
      if (!res.ok) continue;
      const data = res.data;
      if (data.kind !== "markdown" || !data.content) continue;
      const p = parseChecklist(data.content);
      if (p) {
        setProgress({ ...p, file: f });
        setProgressMd(data.content);
        return;
      }
    }
    setProgress(null);
  }, [root]);

  // Check progress files only at the root, and only when the root listing
  // actually changes — not on every poll tick (each check is up to 3 Drive
  // reads, so per-tick was hammering the mount).
  const progressSig = useRef("");
  useEffect(() => {
    if (cwd !== "" || !entries) return;
    const sig = entries.map((e) => e.name).join("|");
    if (sig === progressSig.current) return;
    progressSig.current = sig;
    loadProgress();
  }, [entries, cwd, loadProgress]);

  const openFile = async (sub: string, name: string) => {
    setSelected({ sub, name });
    if (HTMLRE.test(name)) return setFileData({ kind: "html" });
    if (PDF.test(name)) return setFileData({ kind: "pdf" });
    if (VIDEO.test(name)) return setFileData({ kind: "video" });
    if (AUDIO.test(name)) return setFileData({ kind: "audio" });
    setFileData(null);
    const res = await api.post<FileData>("/api/fs/read", { root, sub });
    if (!res.ok) console.warn(`[workspace] read failed: ${res.error}`);
    setFileData(res.ok ? res.data : { kind: "binary" });
  };

  if (!root) {
    return (
      <div className="p-4 text-[12px] text-ink-faint">This project has no working folder set.</div>
    );
  }

  return (
    <div className="flex flex-col h-full text-sm">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-line flex items-center gap-2">
        <HardDrive size={12} className="text-ink-faint shrink-0" />
        <span className="text-[11px] text-ink-faint font-mono truncate flex-1" title={root}>
          {root.split("/").filter(Boolean).pop() ?? root}
        </span>
        <button
          onClick={() => {
            progressSig.current = "";
            list();
          }}
          className="p-1 rounded-md hover:bg-parchment-dark text-ink-faint"
          title="Refresh"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Progress */}
      {progress && !selected && (
        <div className="px-3 py-2.5 border-b border-line">
          <button
            onClick={() => setShowProgress(!showProgress)}
            className="w-full text-left"
            title={`From ${progress.file}`}
          >
            <div className="flex items-center gap-1.5 mb-1.5 text-[12px]">
              <ListChecks size={13} className="text-accent" />
              <span className="font-medium">Progress</span>
              <span className="ml-auto text-ink-faint">
                {progress.done} of {progress.total}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-parchment-dark overflow-hidden">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
          </button>
          {showProgress && (
            <div
              className="mt-2 max-h-48 overflow-y-auto text-[12px] leading-relaxed text-ink-soft md-body"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(progressMd) }}
            />
          )}
        </div>
      )}

      {selected ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
            <button
              onClick={() => setSelected(null)}
              className="p-1 rounded-md hover:bg-parchment-dark text-ink-soft"
              title="Back to files"
            >
              <ArrowLeft size={13} />
            </button>
            <p className="text-[12px] font-medium truncate flex-1">{selected.name}</p>
            <span className="text-[10px] text-ink-faint shrink-0">{fmtSize(fileData?.size)}</span>
            <a
              href={rawUrl(selected.sub, true)}
              className="p-1 rounded-md hover:bg-parchment-dark text-ink-faint hover:text-ink"
              title="Download"
            >
              <Download size={12} />
            </a>
          </div>
          <div className="flex-1 overflow-auto">
            {!fileData && <p className="p-3 text-[12px] text-ink-faint">Loading…</p>}
            {fileData?.kind === "image" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={rawUrl(selected.sub)} alt={selected.name} className="max-w-full p-3" />
            )}
            {fileData?.kind === "markdown" && (
              <div
                className="p-3 text-[13px] leading-relaxed md-body"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(fileData.content ?? "") }}
              />
            )}
            {(fileData?.kind === "code" || fileData?.kind === "text") && (
              <pre className="p-3 text-[12px] leading-relaxed font-mono whitespace-pre-wrap">
                {fileData.content}
              </pre>
            )}
            {fileData?.kind === "html" && (
              <iframe
                src={rawUrl(selected.sub)}
                sandbox="allow-scripts"
                className="w-full h-full bg-white"
                title={selected.name}
              />
            )}
            {fileData?.kind === "pdf" && (
              <iframe src={rawUrl(selected.sub)} className="w-full h-full" title={selected.name} />
            )}
            {fileData?.kind === "video" && (
              <video controls src={rawUrl(selected.sub)} className="max-w-full p-3" />
            )}
            {fileData?.kind === "audio" && (
              <audio controls src={rawUrl(selected.sub)} className="w-full p-3" />
            )}
            {fileData?.kind === "binary" && (
              <div className="flex flex-col items-center justify-center gap-3 py-10 px-4 text-center">
                <p className="text-[12px] text-ink-faint">
                  This file type can&apos;t be previewed.
                </p>
                <a
                  href={rawUrl(selected.sub, true)}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[12px] text-white hover:bg-accent-hover"
                >
                  <Download size={13} /> Download
                </a>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
          {/* FolderNav carries its own bottom border; the sort button sits on
              the same strip, matching its background so it reads as one bar. */}
          <div className="flex items-stretch">
            <div className="flex-1 min-w-0">
              <FolderNav
                sub={cwd}
                onNavigate={(s) => {
                  setCwd(s);
                  setEntries(null);
                }}
              />
            </div>
            <div className="flex items-center px-1.5 border-b border-line bg-parchment-dark/40 shrink-0">
              <SortMenu value={sort} onChange={setSort} storageKey="workspace" />
            </div>
          </div>

          {error && <p className="px-3 py-2 text-[12px] text-red-500">{error}</p>}
          {!error && !entries && <p className="px-3 py-2 text-[12px] text-ink-faint">Loading…</p>}
          {entries && entries.length === 0 && (
            <p className="px-3 py-2 text-[12px] text-ink-faint">Empty folder.</p>
          )}

          <div className="px-1.5 py-1">
            {entries
              ?.slice()
              // Folders always group before files; the chosen sort applies inside each group.
              .sort((a, b) => (a.isDir === b.isDir ? compareEntries(sort, a, b) : a.isDir ? -1 : 1))
              .map((e) => (
                <button
                  key={e.name}
                  onClick={() =>
                    e.isDir
                      ? (setCwd(cwd ? `${cwd}/${e.name}` : e.name), setEntries(null))
                      : openFile(cwd ? `${cwd}/${e.name}` : e.name, e.name)
                  }
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-parchment-dark text-left"
                >
                  {iconFor(e.name, e.isDir)}
                  <span className="text-[12.5px] truncate flex-1">{e.name}</span>
                  {!e.isDir && (
                    <span className="text-[10px] text-ink-faint">{fmtSize(e.size)}</span>
                  )}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
