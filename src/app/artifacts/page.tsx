"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Package, FileText, Code2, Globe, GitBranch, Copy, Check, MessageSquare, X } from "lucide-react";
import { useHermesStore } from "@/lib/store";
import { timeAgo } from "@/lib/format";
import { Artifact, ArtifactKind } from "@/lib/types";

const kindIcon: Record<ArtifactKind, React.ReactNode> = {
  document: <FileText size={15} />,
  code: <Code2 size={15} />,
  html: <Globe size={15} />,
  diagram: <GitBranch size={15} />,
};

function ArtifactsContent() {
  const searchParams = useSearchParams();
  const artifacts = useHermesStore((s) => s.artifacts);
  const chats = useHermesStore((s) => s.chats);
  const [openId, setOpenId] = useState<string | null>(searchParams.get("open"));
  const [filter, setFilter] = useState<ArtifactKind | "all">("all");
  const [copied, setCopied] = useState(false);

  const open = artifacts.find((a) => a.id === openId);
  const sorted = [...artifacts]
    .filter((a) => filter === "all" || a.kind === filter)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const copy = (a: Artifact) => {
    navigator.clipboard.writeText(a.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex h-full">
      {/* List */}
      <div className={`${open ? "w-96 border-r border-line" : "flex-1"} overflow-y-auto shrink-0`}>
        <div className={`${open ? "px-5" : "mx-auto max-w-4xl px-8"} py-10`}>
          <h1 className="font-serif-display text-3xl mb-1">Artifacts</h1>
          <p className="text-sm text-ink-soft mb-6">
            Everything Hermes has produced — documents, code, pages and diagrams.
          </p>

          <div className="flex flex-wrap gap-1.5 mb-6">
            {(["all", "document", "code", "html", "diagram"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`rounded-full px-3 py-1 text-[12px] capitalize transition-colors ${
                  filter === k
                    ? "bg-ink text-parchment"
                    : "border border-line bg-card text-ink-soft hover:border-ink-faint"
                }`}
              >
                {k}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {sorted.map((a) => {
              const chat = a.chatId ? chats.find((c) => c.id === a.chatId) : undefined;
              return (
                <button
                  key={a.id}
                  onClick={() => setOpenId(a.id)}
                  className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${
                    openId === a.id
                      ? "border-accent bg-accent-soft"
                      : "border-line bg-card hover:border-ink-faint"
                  }`}
                >
                  <div className="flex items-center gap-2.5 mb-1">
                    <span className="text-accent">{kindIcon[a.kind]}</span>
                    <p className="text-sm font-medium truncate">{a.title}</p>
                  </div>
                  <p className="text-[12px] text-ink-faint">
                    <span className="capitalize">{a.kind}</span>
                    {a.language && ` · ${a.language}`} · updated {timeAgo(a.updatedAt)}
                    {chat && ` · from "${chat.title}"`}
                  </p>
                </button>
              );
            })}
            {sorted.length === 0 && (
              <p className="text-sm text-ink-faint">No artifacts of this type yet.</p>
            )}
          </div>
        </div>
      </div>

      {/* Preview */}
      {open && (
        <div className="flex-1 min-w-0 flex flex-col bg-card">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-accent">{kindIcon[open.kind]}</span>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{open.title}</p>
                <p className="text-[11px] text-ink-faint capitalize">
                  {open.kind}
                  {open.language && ` · ${open.language}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {open.chatId && (
                <Link
                  href={`/chat/${open.chatId}`}
                  className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
                  title="Open source conversation"
                >
                  <MessageSquare size={15} />
                </Link>
              )}
              <button
                onClick={() => copy(open)}
                className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
                title="Copy content"
              >
                {copied ? <Check size={15} className="text-green-600" /> : <Copy size={15} />}
              </button>
              <button
                onClick={() => setOpenId(null)}
                className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
                title="Close"
              >
                <X size={15} />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {open.kind === "html" ? (
              <iframe
                srcDoc={open.content}
                sandbox=""
                className="w-full h-full bg-white"
                title={open.title}
              />
            ) : (
              <pre className="p-5 text-[13px] leading-relaxed whitespace-pre-wrap font-mono text-ink">
                {open.content}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ArtifactsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-ink-faint text-sm">
          <Package size={15} className="mr-2" /> Loading artifacts…
        </div>
      }
    >
      <ArtifactsContent />
    </Suspense>
  );
}
