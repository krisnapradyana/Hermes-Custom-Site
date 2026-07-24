"use client";

import { useMemo, useState } from "react";
import { Paperclip, FileText, FileCode, Image as ImageIcon, File as FileIcon, X, Download, MessageSquare } from "lucide-react";
import Link from "next/link";
import { useHermesStore } from "@/lib/store";
import { timeAgo } from "@/lib/format";
import { Attachment } from "@/lib/types";
import { AttachmentPreview, attachmentIconKind } from "@/components/AttachmentPreview";

interface Item {
  key: string;
  attachment: Attachment;
  chatId: string;
  chatTitle: string;
  createdAt: string;
}

function icon(a: Attachment) {
  const k = attachmentIconKind(a);
  if (k === "image") return <ImageIcon size={15} />;
  if (k === "code") return <FileCode size={15} />;
  if (k === "doc") return <FileText size={15} />;
  return <FileIcon size={15} />;
}

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function AttachmentsPage() {
  const chats = useHermesStore((s) => s.chats);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const items = useMemo(() => {
    const out: Item[] = [];
    const seen = new Set<string>();
    for (const c of chats) {
      for (const m of c.messages) {
        for (const a of m.attachments ?? []) {
          const key = a.id ?? `${a.name}-${a.size}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ key, attachment: a, chatId: c.id, chatTitle: c.title, createdAt: m.createdAt });
        }
      }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [chats]);

  const open = items.find((i) => i.key === openKey);

  return (
    <div className="flex h-full">
      <div className={`${open ? "w-96 border-r border-line" : "flex-1"} overflow-y-auto shrink-0`}>
        <div className={`${open ? "px-5" : "mx-auto max-w-4xl px-8"} py-10`}>
          <h1 className="font-serif-display text-3xl mb-1">Attachments</h1>
          <p className="text-sm text-ink-soft mb-6">Files you&apos;ve uploaded into conversations.</p>

          <div className="space-y-2">
            {items.map((it) => (
              <button
                key={it.key}
                onClick={() => setOpenKey(it.key)}
                className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${
                  openKey === it.key ? "border-accent bg-accent-soft" : "border-line bg-card hover:border-ink-faint"
                }`}
              >
                <div className="flex items-center gap-2.5 mb-1">
                  <span className="text-accent">{icon(it.attachment)}</span>
                  <p className="text-sm font-medium truncate">{it.attachment.name}</p>
                </div>
                <p className="text-[12px] text-ink-faint">
                  {fmtSize(it.attachment.size)} · {timeAgo(it.createdAt)} · from &ldquo;{it.chatTitle}&rdquo;
                </p>
              </button>
            ))}
            {items.length === 0 && (
              <p className="text-sm text-ink-faint">No attachments yet. Upload a file in a chat to see it here.</p>
            )}
          </div>
        </div>
      </div>

      {open && (
        <div className="flex-1 min-w-0 flex flex-col bg-card">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-accent">{icon(open.attachment)}</span>
              <p className="text-sm font-medium truncate">{open.attachment.name}</p>
            </div>
            <div className="flex items-center gap-1">
              <Link
                href={`/chat/${open.chatId}`}
                className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
                title="Open source conversation"
              >
                <MessageSquare size={15} />
              </Link>
              <a
                href={
                  open.attachment.dataUrl ??
                  `/api/attachments/${open.attachment.id}?download=1`
                }
                download={open.attachment.name}
                className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
                title="Download"
              >
                <Download size={15} />
              </a>
              <button
                onClick={() => setOpenKey(null)}
                className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
                title="Close"
              >
                <X size={15} />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            <AttachmentPreview attachment={open.attachment} />
          </div>
        </div>
      )}
    </div>
  );
}
