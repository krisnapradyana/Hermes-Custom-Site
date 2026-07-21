"use client";

import { Attachment } from "@/lib/types";

const TEXT_RE = /\.(md|markdown|txt|csv|tsv|json|ts|tsx|js|jsx|py|sh|sql|css|html?|ya?ml|xml|log|env|toml|ini)$/i;
const CODE_RE = /\.(ts|tsx|js|jsx|py|sh|sql|css|html?|ya?ml|xml|toml|ini|rs|go)$/i;

function isText(a: Attachment) {
  return a.type.startsWith("text/") || a.type === "application/json" || TEXT_RE.test(a.name);
}

function decode(dataUrl: string): string {
  try {
    const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

export function AttachmentPreview({ attachment }: { attachment: Attachment }) {
  const a = attachment;
  if (a.type.startsWith("image/")) {
    return (
      <div className="flex items-center justify-center h-full p-4 overflow-auto">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={a.dataUrl} alt={a.name} className="max-w-full max-h-full rounded-lg" />
      </div>
    );
  }
  if (a.type === "application/pdf" || /\.pdf$/i.test(a.name)) {
    return <iframe src={a.dataUrl} className="w-full h-full" title={a.name} />;
  }
  if (a.type.startsWith("video/")) {
    // eslint-disable-next-line jsx-a11y/media-has-caption
    return <video controls src={a.dataUrl} className="max-w-full p-3" />;
  }
  if (a.type.startsWith("audio/")) {
    // eslint-disable-next-line jsx-a11y/media-has-caption
    return <audio controls src={a.dataUrl} className="w-full p-3" />;
  }
  if (isText(a)) {
    return (
      <pre className="p-5 text-[13px] leading-relaxed whitespace-pre-wrap font-mono text-ink overflow-auto h-full">
        {decode(a.dataUrl)}
      </pre>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-ink-faint">
      <p className="text-sm">No inline preview for this file type.</p>
      <a
        href={a.dataUrl}
        download={a.name}
        className="rounded-lg bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover"
      >
        Download {a.name}
      </a>
    </div>
  );
}

export function attachmentIconKind(a: Attachment): "image" | "code" | "doc" | "file" {
  if (a.type.startsWith("image/")) return "image";
  if (CODE_RE.test(a.name)) return "code";
  if (isText(a) || a.type === "application/pdf" || /\.(pdf|docx?|xlsx?)$/i.test(a.name)) return "doc";
  return "file";
}
