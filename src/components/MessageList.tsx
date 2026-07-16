"use client";

import Link from "next/link";
import { Package, Zap, FileText } from "lucide-react";
import { Message } from "@/lib/types";
import { useHermesStore } from "@/lib/store";

export function MessageList({
  messages,
  streaming,
  onOpenArtifact,
}: {
  messages: Message[];
  streaming: boolean;
  onOpenArtifact?: (artifactId: string) => void;
}) {
  const artifacts = useHermesStore((s) => s.artifacts);

  return (
    <div className="space-y-6">
      {messages.map((m) => {
        const artifact = m.artifactId ? artifacts.find((a) => a.id === m.artifactId) : undefined;
        return m.role === "user" ? (
          <div key={m.id} className="flex justify-end">
            <div className="max-w-[75%] space-y-2">
              {m.attachments && m.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 justify-end">
                  {m.attachments.map((a, i) =>
                    a.type.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={i}
                        src={a.dataUrl}
                        alt={a.name}
                        className="max-h-40 rounded-xl border border-line"
                      />
                    ) : (
                      <div
                        key={i}
                        className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 py-1.5"
                      >
                        <FileText size={12} className="text-accent" />
                        <span className="text-[12px]">{a.name}</span>
                      </div>
                    )
                  )}
                </div>
              )}
              <div className="rounded-2xl rounded-br-md bg-parchment-dark px-4 py-2.5 text-[15px] whitespace-pre-wrap">
                {m.content}
              </div>
            </div>
          </div>
        ) : (
          <div key={m.id} className="flex gap-3">
            <div className="w-7 h-7 shrink-0 rounded-full bg-accent-soft flex items-center justify-center mt-0.5">
              <Zap size={13} className="text-accent" fill="currentColor" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] leading-relaxed whitespace-pre-wrap">{m.content}</div>
              {artifact &&
                (onOpenArtifact ? (
                  <button
                    onClick={() => onOpenArtifact(artifact.id)}
                    className="mt-3 flex items-center gap-3 rounded-xl border border-line bg-card px-3.5 py-2.5 hover:border-ink-faint transition-colors max-w-sm w-full text-left"
                  >
                    <ArtifactCardBody title={artifact.title} kind={artifact.kind} />
                  </button>
                ) : (
                  <Link
                    href={`/artifacts?open=${artifact.id}`}
                    className="mt-3 flex items-center gap-3 rounded-xl border border-line bg-card px-3.5 py-2.5 hover:border-ink-faint transition-colors max-w-sm"
                  >
                    <ArtifactCardBody title={artifact.title} kind={artifact.kind} />
                  </Link>
                ))}
            </div>
          </div>
        );
      })}

      {streaming && (
        <div className="flex gap-3">
          <div className="w-7 h-7 shrink-0 rounded-full bg-accent-soft flex items-center justify-center mt-0.5">
            <Zap size={13} className="text-accent" fill="currentColor" />
          </div>
          <div className="flex items-center gap-1.5 pt-2">
            <span className="w-1.5 h-1.5 rounded-full bg-ink-faint animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-ink-faint animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-ink-faint animate-bounce [animation-delay:300ms]" />
          </div>
        </div>
      )}
    </div>
  );
}

function ArtifactCardBody({ title, kind }: { title: string; kind: string }) {
  return (
    <>
      <div className="w-9 h-9 rounded-lg bg-accent-soft flex items-center justify-center shrink-0">
        <Package size={16} className="text-accent" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{title}</p>
        <p className="text-[11px] text-ink-faint capitalize">{kind} · click to open</p>
      </div>
    </>
  );
}
