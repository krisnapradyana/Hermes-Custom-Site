"use client";

import { useRef, useState } from "react";
import { ArrowUp, Paperclip, X, FileText } from "lucide-react";
import { Attachment } from "@/lib/types";

const MAX_FILE_MB = 5;

export function Composer({
  onSend,
  disabled,
  placeholder = "Message Assistant…",
  autoFocus,
}: {
  onSend: (text: string, attachments: Attachment[]) => void;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [warn, setWarn] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
    onSend(text || "(see attachment)", attachments);
    setValue("");
    setAttachments([]);
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

      <textarea
        ref={ref}
        value={value}
        autoFocus={autoFocus}
        rows={1}
        placeholder={placeholder}
        className="w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] outline-none placeholder:text-ink-faint max-h-48"
        onChange={(e) => {
          setValue(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = `${Math.min(e.target.scrollHeight, 192)}px`;
        }}
        onKeyDown={(e) => {
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
            {warn || "Assistant · powered by Hermes"}
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
