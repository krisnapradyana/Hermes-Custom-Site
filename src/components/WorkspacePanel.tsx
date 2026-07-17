"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Folder,
  FileText,
  FileCode,
  FileImage,
  File as FileIcon,
  ChevronRight,
  ArrowLeft,
  HardDrive,
  ListChecks,
  RefreshCw,
} from "lucide-react";
import { Project } from "@/lib/types";
import { renderMarkdown, parseChecklist, ChecklistProgress } from "@/lib/markdown";

interface Entry {
  name: string;
  isDir: boolean;
  size?: number;
  mtime?: string;
}

interface FileData {
  kind: "image" | "markdown" | "code" | "text" | "binary";
  content?: string;
  dataUrl?: string;
  size?: number;
}

const PROGRESS_FILES = ["PROGRESS.md", "TODO.md", "README.md"];

function fmtSize(n?: number): string {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function iconFor(name: string, isDir: boolean) {
  if (isDir) return <Folder size={14} className="text-accent shrink-0" />;
  const lower = name.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|svg|bmp|ico)$/.test(lower))
    return <FileImage size={14} className="text-ink-faint shrink-0" />;
  if (/\.(ts|tsx|js|jsx|py|sh|css|html|json|yml|yaml|sql|rs|go)$/.test(lower))
    return <FileCode size={14} className="text-ink-faint shrink-0" />;
  if (/\.(md|txt|csv|log)$/.test(lower))
    return <FileText size={14} className="text-ink-faint shrink-0" />;
  return <FileIcon size={14} className="text-ink-faint shrink-0" />;
}

export function WorkspacePanel({ project }: { project: Project }) {
  const hasDrive = !!project.driveFolder;
  const [rootKey, setRootKey] = useState<"working" | "drive">("working");
  const root = rootKey === "drive" && project.driveFolder ? project.driveFolder : project.workingFolder ?? "";

  const [cwd, setCwd] = useState("");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<(ChecklistProgress & { file: string }) | null>(null);
  const [progressMd, setProgressMd] = useState("");
  const [showProgress, setShowProgress] = useState(false);

  const [selected, setSelected] = useState<{ sub: string; name: string } | null>(null);
  const [fileData, setFileData] = useState<FileData | null>(null);

  const list = useCallback(
    async (silent = false) => {
      if (!root) return;
      setError("");
      if (!silent) setEntries(null);
      try {
        const res = await fetch("/api/fs/list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ root, sub: cwd }),
        });
        const data = await res.json();
        if (!res.ok) setError(data.error ?? "Could not read folder");
        else setEntries(data.entries);
      } catch {
        setError("Could not reach the server");
      }
    },
    [root, cwd]
  );

  useEffect(() => {
    list();
  }, [list]);

  // Progress: first markdown file at the root that contains checkboxes.
  const loadProgress = useCallback(async () => {
    if (!root) return;
    for (const f of PROGRESS_FILES) {
      try {
        const res = await fetch("/api/fs/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ root, sub: f }),
        });
        if (!res.ok) continue;
        const data = (await res.json()) as FileData;
        if (data.kind !== "markdown" || !data.content) continue;
        const p = parseChecklist(data.content);
        if (p) {
          setProgress({ ...p, file: f });
          setProgressMd(data.content);
          return;
        }
      } catch {}
    }
    setProgress(null);
  }, [root]);

  useEffect(() => {
    loadProgress();
  }, [loadProgress]);

  // Live updates: subscribe to the folder's filesystem event stream (SSE).
  // Fires for agent-generated files AND external changes (Explorer, Drive sync…).
  const selectedRef = useRef<{ sub: string; name: string } | null>(null);
  const openFileRef = useRef<(sub: string, name: string) => void>(() => {});

  useEffect(() => {
    if (!root) return;
    const es = new EventSource(`/api/fs/watch?root=${encodeURIComponent(root)}`);
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as { type: string; paths?: string[] };
        if (msg.type !== "change") return;
        // Refresh listing (silently — no loading flicker) and progress.
        list(true);
        loadProgress();
        // If the open file changed on disk, re-load it in place.
        const sel = selectedRef.current;
        if (sel && msg.paths?.some((p) => p === sel.sub)) {
          openFileRef.current(sel.sub, sel.name);
        }
      } catch {}
    };
    return () => es.close();
  }, [root, list, loadProgress]);

  const openFile = useCallback(
    async (sub: string, name: string) => {
      // Show the loader only when opening a different file; live re-loads
      // of the same file keep the current view (no flicker).
      if (selectedRef.current?.sub !== sub) setFileData(null);
      setSelected({ sub, name });
      selectedRef.current = { sub, name };
      try {
        const res = await fetch("/api/fs/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ root, sub }),
        });
        const data = await res.json();
        setFileData(res.ok ? data : { kind: "binary" });
      } catch {
        setFileData({ kind: "binary" });
      }
    },
    [root]
  );
  openFileRef.current = openFile;

  const closeFile = () => {
    setSelected(null);
    selectedRef.current = null;
    setFileData(null);
  };

  if (!project.workingFolder) {
    return (
      <div className="p-4 text-[12px] text-ink-faint">
        Set a working folder on the project to see files here.
      </div>
    );
  }

  const crumbs = cwd ? cwd.split("/").filter(Boolean) : [];

  return (
    <div className="flex flex-col h-full text-sm">
      {/* Root switcher */}
      <div className="px-3 pt-3 pb-2 border-b border-line">
        <div className="flex items-center gap-1.5 mb-1.5">
          {(["working", ...(hasDrive ? (["drive"] as const) : [])] as const).map((k) => (
            <button
              key={k}
              onClick={() => {
                setRootKey(k);
                setCwd("");
                closeFile();
              }}
              className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                rootKey === k
                  ? "bg-accent text-white"
                  : "border border-line text-ink-soft hover:border-ink-faint"
              }`}
            >
              {k === "working" ? "Working folder" : "Google Drive"}
            </button>
          ))}
          <button
            onClick={() => list()}
            className="ml-auto p-1 rounded-md hover:bg-parchment-dark text-ink-faint"
            title="Refresh"
          >
            <RefreshCw size={12} />
          </button>
        </div>
        <p className="flex items-center gap-1.5 text-[11px] text-ink-faint font-mono truncate" title={root}>
          <HardDrive size={11} className="shrink-0" />
          {root}
        </p>
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

      {/* File view or list */}
      {selected ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
            <button
              onClick={closeFile}
              className="p-1 rounded-md hover:bg-parchment-dark text-ink-soft"
              title="Back to files"
            >
              <ArrowLeft size={13} />
            </button>
            <p className="text-[12px] font-medium truncate">{selected.name}</p>
            <span className="ml-auto text-[10px] text-ink-faint">{fmtSize(fileData?.size)}</span>
          </div>
          <div className="flex-1 overflow-auto">
            {!fileData && <p className="p-3 text-[12px] text-ink-faint">Loading…</p>}
            {fileData?.kind === "image" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fileData.dataUrl} alt={selected.name} className="max-w-full p-3" />
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
            {fileData?.kind === "binary" && (
              <p className="p-3 text-[12px] text-ink-faint">
                Binary file — no preview available.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Breadcrumb */}
          <div className="flex items-center flex-wrap gap-0.5 px-3 pt-2 text-[11px] text-ink-faint">
            <button onClick={() => setCwd("")} className="hover:text-ink">
              root
            </button>
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-0.5">
                <ChevronRight size={10} />
                <button
                  onClick={() => setCwd(crumbs.slice(0, i + 1).join("/"))}
                  className="hover:text-ink"
                >
                  {c}
                </button>
              </span>
            ))}
          </div>

          {error && <p className="px-3 py-2 text-[12px] text-red-500">{error}</p>}
          {!error && !entries && <p className="px-3 py-2 text-[12px] text-ink-faint">Loading…</p>}
          {entries && entries.length === 0 && (
            <p className="px-3 py-2 text-[12px] text-ink-faint">Empty folder.</p>
          )}

          <div className="px-1.5 py-1">
            {entries?.map((e) => (
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
                {!e.isDir && <span className="text-[10px] text-ink-faint">{fmtSize(e.size)}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
