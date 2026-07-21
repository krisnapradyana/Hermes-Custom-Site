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
  FolderOpen,
  Download,
  Lock,
} from "lucide-react";
import { Project } from "@/lib/types";
import { renderMarkdown, parseChecklist, ChecklistProgress } from "@/lib/markdown";
import { buildManifest, manifestSignature } from "@/lib/manifest";
import {
  FSDir,
  LocalEntry,
  supportsLocalFs,
  pickDirectory,
  saveDirHandle,
  getDirHandle,
  ensurePermission,
  listDir,
  getFile,
} from "@/lib/local-fs";

type PreviewKind = "image" | "markdown" | "code" | "text" | "pdf" | "video" | "audio" | "binary";
interface Preview {
  kind: PreviewKind;
  text?: string;
  url?: string;
  size: number;
  name: string;
}

const PROGRESS_FILES = ["PROGRESS.md", "TODO.md", "README.md"];
const IMG = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;
const CODE = /\.(ts|tsx|js|jsx|py|sh|css|scss|html?|json|ya?ml|sql|rs|go|java|c|cpp|h|rb|php|mjs|cjs|vue|svelte|toml|ini)$/i;
const TXT = /\.(txt|csv|tsv|log|env)$/i;
const MD = /\.(md|markdown)$/i;
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
  if (MD.test(name) || TXT.test(name)) return <FileText size={14} className="text-ink-faint shrink-0" />;
  return <FileIcon size={14} className="text-ink-faint shrink-0" />;
}

export function WorkspacePanel({ project }: { project: Project }) {
  const supported = supportsLocalFs();
  const [root, setRoot] = useState<FSDir | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [stack, setStack] = useState<{ handle: FSDir; name: string }[]>([]);
  const [entries, setEntries] = useState<LocalEntry[] | null>(null);
  const [progress, setProgress] = useState<(ChecklistProgress & { file: string }) | null>(null);
  const [progressMd, setProgressMd] = useState("");
  const [showProgress, setShowProgress] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const urlRef = useRef<string | null>(null);

  const cwd = stack.length ? stack[stack.length - 1].handle : null;

  // Try to restore a saved handle for this project on mount.
  useEffect(() => {
    let alive = true;
    (async () => {
      const saved = await getDirHandle(project.id);
      if (!alive || !saved) return;
      const granted = await ensurePermission(saved).catch(() => false);
      if (!alive) return;
      if (granted) {
        setRoot(saved);
        setStack([{ handle: saved, name: saved.name }]);
      } else {
        // Handle exists but permission must be re-granted with a click.
        setRoot(saved);
        setNeedsPermission(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [project.id]);

  const connect = async () => {
    const dir = await pickDirectory();
    if (!dir) return;
    await saveDirHandle(project.id, dir);
    setRoot(dir);
    setNeedsPermission(false);
    setStack([{ handle: dir, name: dir.name }]);
  };

  const reconnect = async () => {
    if (!root) return;
    const ok = await ensurePermission(root);
    if (ok) {
      setNeedsPermission(false);
      setStack([{ handle: root, name: root.name }]);
    }
  };

  const refresh = useCallback(async () => {
    if (!cwd) return;
    try {
      setEntries(await listDir(cwd));
    } catch {
      setNeedsPermission(true);
    }
  }, [cwd]);

  useEffect(() => {
    if (cwd) refresh();
  }, [cwd, refresh]);

  // Light polling so agent/external changes appear without a manual refresh.
  useEffect(() => {
    if (!cwd) return;
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [cwd, refresh]);

  // Keep the server-side folder manifest (the agent's "identity card") fresh:
  // rebuild from the root handle on connect and periodically, upload on change.
  const lastSig = useRef<string>("");
  const syncManifest = useCallback(async () => {
    if (!root) return;
    try {
      const manifest = await buildManifest(root);
      const sig = manifestSignature(manifest);
      if (sig === lastSig.current) return; // unchanged — skip upload
      lastSig.current = sig;
      await fetch(`/api/projects/${encodeURIComponent(project.id)}/manifest`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(manifest),
      });
    } catch {}
  }, [root, project.id]);

  useEffect(() => {
    if (!root) return;
    syncManifest();
    const t = setInterval(syncManifest, 20000);
    return () => clearInterval(t);
  }, [root, syncManifest]);

  // Progress widget from the root folder.
  const loadProgress = useCallback(async () => {
    if (!root) return;
    for (const f of PROGRESS_FILES) {
      const file = await getFile(root, f);
      if (!file) continue;
      const text = await file.text();
      const p = parseChecklist(text);
      if (p) {
        setProgress({ ...p, file: f });
        setProgressMd(text);
        return;
      }
    }
    setProgress(null);
  }, [root]);

  useEffect(() => {
    loadProgress();
  }, [loadProgress, entries]);

  const setPreviewUrl = (url: string | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;
  };
  useEffect(() => () => setPreviewUrl(null), []);

  const openFile = async (name: string) => {
    if (!cwd) return;
    const file = await getFile(cwd, name);
    if (!file) return;
    if (IMG.test(name) || PDF.test(name) || VIDEO.test(name) || AUDIO.test(name) || /\.html?$/i.test(name)) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      const kind: PreviewKind = IMG.test(name)
        ? "image"
        : PDF.test(name)
        ? "pdf"
        : VIDEO.test(name)
        ? "video"
        : AUDIO.test(name)
        ? "audio"
        : "markdown"; // html handled below via url in iframe
      setPreview({
        kind: /\.html?$/i.test(name) ? "binary" : kind,
        url,
        size: file.size,
        name,
        text: /\.html?$/i.test(name) ? "html" : undefined,
      });
      return;
    }
    if (MD.test(name) || CODE.test(name) || TXT.test(name) || !file.type) {
      if (file.size > 2 * 1024 * 1024) {
        setPreview({ kind: "binary", size: file.size, name });
        return;
      }
      const text = await file.text();
      setPreview({ kind: MD.test(name) ? "markdown" : CODE.test(name) ? "code" : "text", text, size: file.size, name });
      return;
    }
    setPreview({ kind: "binary", size: file.size, name });
  };

  const closeFile = () => {
    setPreviewUrl(null);
    setPreview(null);
  };

  const download = () => {
    if (!preview?.url) return;
    const a = document.createElement("a");
    a.href = preview.url;
    a.download = preview.name;
    a.click();
  };

  // --- Render states ---

  if (!supported) {
    return (
      <div className="p-4 text-[12px] text-ink-faint leading-relaxed">
        Folder preview needs a Chromium browser (Edge or Chrome). Your files
        still work — this panel just can&apos;t display them here.
      </div>
    );
  }

  if (!root || needsPermission) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
        <FolderOpen size={24} className="text-accent" />
        <p className="text-[13px] text-ink-soft">
          {needsPermission
            ? "Reconnect this project's folder to view its files."
            : "Connect this project's folder to browse it here."}
        </p>
        {project.workingFolder && (
          <p className="text-[11px] text-ink-faint font-mono break-all">{project.workingFolder}</p>
        )}
        <button
          onClick={needsPermission ? reconnect : connect}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm text-white hover:bg-accent-hover"
        >
          {needsPermission ? <Lock size={14} /> : <FolderOpen size={14} />}
          {needsPermission ? "Reconnect folder" : "Connect folder"}
        </button>
        <p className="text-[10.5px] text-ink-faint">Read directly in your browser — never uploaded.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full text-sm">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-line flex items-center gap-2">
        <HardDrive size={12} className="text-ink-faint shrink-0" />
        <span className="text-[11px] text-ink-faint font-mono truncate flex-1" title={stack[0]?.name}>
          {stack[0]?.name}
        </span>
        <button onClick={refresh} className="p-1 rounded-md hover:bg-parchment-dark text-ink-faint" title="Refresh">
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Progress */}
      {progress && !preview && (
        <div className="px-3 py-2.5 border-b border-line">
          <button onClick={() => setShowProgress(!showProgress)} className="w-full text-left" title={`From ${progress.file}`}>
            <div className="flex items-center gap-1.5 mb-1.5 text-[12px]">
              <ListChecks size={13} className="text-accent" />
              <span className="font-medium">Progress</span>
              <span className="ml-auto text-ink-faint">
                {progress.done} of {progress.total}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-parchment-dark overflow-hidden">
              <div className="h-full bg-accent transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
          </button>
          {showProgress && (
            <div className="mt-2 max-h-48 overflow-y-auto text-[12px] leading-relaxed text-ink-soft md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(progressMd) }} />
          )}
        </div>
      )}

      {preview ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
            <button onClick={closeFile} className="p-1 rounded-md hover:bg-parchment-dark text-ink-soft" title="Back to files">
              <ArrowLeft size={13} />
            </button>
            <p className="text-[12px] font-medium truncate flex-1">{preview.name}</p>
            <span className="text-[10px] text-ink-faint shrink-0">{fmtSize(preview.size)}</span>
            {preview.url && (
              <button onClick={download} className="p-1 rounded-md hover:bg-parchment-dark text-ink-faint hover:text-ink" title="Download">
                <Download size={12} />
              </button>
            )}
          </div>
          <div className="flex-1 overflow-auto">
            {preview.kind === "image" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.url} alt={preview.name} className="max-w-full p-3" />
            )}
            {preview.kind === "markdown" && (
              <div className="p-3 text-[13px] leading-relaxed md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(preview.text ?? "") }} />
            )}
            {(preview.kind === "code" || preview.kind === "text") && (
              <pre className="p-3 text-[12px] leading-relaxed font-mono whitespace-pre-wrap">{preview.text}</pre>
            )}
            {preview.kind === "pdf" && <iframe src={preview.url} className="w-full h-full" title={preview.name} />}
            {preview.kind === "video" && (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video controls src={preview.url} className="max-w-full p-3" />
            )}
            {preview.kind === "audio" && (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <audio controls src={preview.url} className="w-full p-3" />
            )}
            {preview.kind === "binary" && preview.text === "html" && (
              <iframe src={preview.url} sandbox="allow-scripts" className="w-full h-full bg-white" title={preview.name} />
            )}
            {preview.kind === "binary" && preview.text !== "html" && (
              <div className="flex flex-col items-center justify-center gap-3 py-10 px-4 text-center">
                <p className="text-[12px] text-ink-faint">This file can&apos;t be previewed here.</p>
                {preview.url && (
                  <button onClick={download} className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[12px] text-white hover:bg-accent-hover">
                    <Download size={13} /> Download
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Breadcrumb */}
          <div className="flex items-center flex-wrap gap-0.5 px-3 pt-2 text-[11px] text-ink-faint">
            {stack.map((s, i) => (
              <span key={i} className="flex items-center gap-0.5">
                {i > 0 && <ChevronRight size={10} />}
                <button onClick={() => setStack(stack.slice(0, i + 1))} className="hover:text-ink">
                  {i === 0 ? "root" : s.name}
                </button>
              </span>
            ))}
          </div>

          {!entries && <p className="px-3 py-2 text-[12px] text-ink-faint">Loading…</p>}
          {entries && entries.length === 0 && <p className="px-3 py-2 text-[12px] text-ink-faint">Empty folder.</p>}

          <div className="px-1.5 py-1">
            {entries?.map((e) => (
              <button
                key={e.name}
                onClick={async () => {
                  if (e.isDir) {
                    const sub = await cwd.getDirectoryHandle(e.name);
                    setStack([...stack, { handle: sub, name: e.name }]);
                  } else {
                    openFile(e.name);
                  }
                }}
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
