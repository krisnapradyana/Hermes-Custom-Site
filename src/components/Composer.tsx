"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Paperclip, X, FileText, Folder, File as FileIcon } from "lucide-react";
import { Attachment } from "@/lib/types";

const MAX_FILE_MB = 5;

interface TreeFile {
  p: string;
  d: boolean;
}

export function Composer({
  onSend,
  disabled,
  placeholder = "Message Assistant…",
  autoFocus,
  projectId,
}: {
  onSend: (text: string, attachments: Attachment[], mentions?: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /** Enables "@file" mentions from the project's working folder. */
  projectId?: string;
}) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [warn, setWarn] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // --- "@file" mentions (Antigravity-style: reference by path, no upload) ---
  const [tree, setTree] = useState<TreeFile[]>([]);
  const [mentions, setMentions] = useState<string[]>([]); // relative paths
  const [query, setQuery] = useState<string | null>(null); // text after "@"
  const [hi, setHi] = useState(0);

  const loadTree = useCallback(async () => {
    if (!projectId || tree.length) return;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tree`, {
        cache: "no-store",
      });
      if (res.ok) setTree((await res.json()).files ?? []);
    } catch {}
  }, [projectId, tree.length]);

  const suggestions =
    query === null
      ? []
      : tree
          .filter((f) => {
            if (!query) return true;
            const q = query.toLowerCase();
            return f.p.toLowerCase().includes(q);
          })
          .slice(0, 8);

  useEffect(() => {
    setHi(0);
  }, [query]);

  /** Detect an in-progress "@…" token just before the caret. */
  const syncQuery = (text: string, caret: number) => {
    if (!projectId) return;
    const upto = text.slice(0, caret);
    const m = upto.match(/(?:^|\s)@([^\s@]*)$/);
    if (m) {
      setQuery(m[1]);
      loadTree();
    } else {
      setQuery(null);
    }
  };

  const applySuggestion = (f: TreeFile) => {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? value.length;
    const upto = value.slice(0, caret);
    const m = upto.match(/(?:^|\s)@([^\s@]*)$/);
    if (!m) return;
    const start = caret - m[1].length;
    const label = f.p.split("/").pop() ?? f.p;
    const next = value.slice(0, start) + label + " " + value.slice(caret);
    setValue(next);
    setMentions((prev) => (prev.includes(f.p) ? prev : [...prev, f.p]));
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + label.length + 1;
      el.setSelectionRange(pos, pos);
    });
  };

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    setWarn("");
    Array.from(files).forEach((f) => {
      if (f.size > MAX_FILE_MB * 1024 * 1024) {
        setWarn(`"${f.name}" is over ${MAX_FILE_MB}MB — skipped.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () =>
        setAttachments((prev) => [
          ...prev,
          { name: f.name, type: f.type || "application/octet-stream", size: f.size, dataUrl: String(reader.result) },
        ]);
      reader.readAsDataURL(f);
    });
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = () => {
    const text = value.trim();
    if ((!text && attachments.length === 0) || disabled) return;
    // Only keep mentions whose filename still appears in the text.
    const kept = mentions.filter((p) => text.includes((p.split("/").pop() ?? p)));
    onSend(text || "(see attachment)", attachments, kept.length ? kept : undefined);
    setValue("");
    setAttachments([]);
    setMentions([]);
    setQuery(null);
    setWarn("");
    if (ref.current) ref.current.style.height = "auto";
  };

  return (
    <div className="rounded-2xl border border-line bg-card shadow-sm focus-within:border-ink-faint transition-colors">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pt-3">
          {attachments.map((a, i) => (
            <div key={i} className="relative group">
              {a.type.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.dataUrl} alt={a.name} className="h-16 w-16 object-cover rounded-lg border border-line" />
              ) : (
                <div className="flex items-center gap-1.5 rounded-lg border border-line bg-parchment px-2.5 py-2 max-w-44">
                  <FileText size={13} className="text-accent shrink-0" />
                  <span className="text-[11px] truncate">{a.name}</span>
                </div>
              )}
              <button
                onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                className="absolute -top-1.5 -right-1.5 w-4.5 h-4.5 rounded-full bg-ink text-parchment flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                title="Remove"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* @file suggestions */}
      {query !== null && suggestions.length > 0 && (
        <div className="mx-3 mt-3 mb-1 rounded-lg border border-line bg-parchment overflow-hidden">
          <p className="px-2.5 py-1 text-[10.5px] text-ink-faint border-b border-line">
            Files in this project — ↑↓ to choose, Enter to insert
          </p>
          {suggestions.map((f, i) => (
            <button
              key={f.p}
              onMouseDown={(e) => {
                e.preventDefault();
                applySuggestion(f);
              }}
              onMouseEnter={() => setHi(i)}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left ${
                i === hi ? "bg-parchment-dark" : ""
              }`}
            >
              {f.d ? (
                <Folder size={12} className="text-accent shrink-0" />
              ) : (
                <FileIcon size={12} className="text-ink-faint shrink-0" />
              )}
              <span className="text-[12.5px] truncate">{f.p.split("/").pop()}</span>
              {f.p.includes("/") && (
                <span className="text-[10.5px] text-ink-faint truncate ml-auto">
                  {f.p.split("/").slice(0, -1).join("/")}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <textarea
        ref={ref}
        value={value}
        autoFocus={autoFocus}
        rows={1}
        placeholder={placeholder}
        className="w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] outline-none placeholder:text-ink-faint max-h-48"
        onChange={(e) => {
          setValue(e.target.value);
          syncQuery(e.target.value, e.target.selectionStart ?? 0);
          e.target.style.height = "auto";
          e.target.style.height = `${Math.min(e.target.scrollHeight, 192)}px`;
        }}
        onKeyDown={(e) => {
          const open = query !== null && suggestions.length > 0;
          if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setHi((h) =>
              e.key === "ArrowDown"
                ? (h + 1) % suggestions.length
                : (h - 1 + suggestions.length) % suggestions.length
            );
            return;
          }
          if (open && (e.key === "Enter" || e.key === "Tab")) {
            e.preventDefault();
            applySuggestion(suggestions[hi]);
            return;
          }
          if (open && e.key === "Escape") {
            e.preventDefault();
            setQuery(null);
            return;
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        onPaste={(e) => {
          if (e.clipboardData.files.length > 0) {
            e.preventDefault();
            addFiles(e.clipboardData.files);
          }
        }}
      />

      <div className="flex items-center justify-between px-3 pb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="p-1.5 rounded-lg hover:bg-parchment-dark text-ink-faint hover:text-ink transition-colors"
            title="Attach files (images are sent to the agent; text files are inlined)"
          >
            <Paperclip size={15} />
          </button>
          <span className="text-[11px] text-ink-faint truncate">
            {warn ||
              (mentions.length
                ? `${mentions.length} project file${mentions.length > 1 ? "s" : ""} referenced`
                : projectId
                ? "Type @ to reference a project file"
                : "Assistant · powered by Hermes")}
          </span>
        </div>
        <button
          onClick={submit}
          disabled={(!value.trim() && attachments.length === 0) || disabled}
          className="p-1.5 rounded-lg bg-accent text-white disabled:opacity-30 hover:bg-accent-hover transition-colors"
          title="Send"
        >
          <ArrowUp size={16} />
        </button>
      </div>
    </div>
  );
}
