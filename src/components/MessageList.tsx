"use client";

import Link from "next/link";
import { Package, Zap } from "lucide-react";
import { Message } from "@/lib/types";
import { useHermesStore } from "@/lib/store";

export function MessageList({ messages, streaming }: { messages: Message[]; streaming: boolean }) {
  const artifacts = useHermesStore((s) => s.artifacts);

  return (
    <div className="space-y-6">
      {messages.map((m) => {
        const artifact = m.artifactId ? artifacts.find((a) => a.id === m.artifactId) : undefined;
        return m.role === "user" ? (
          <div key={m.id} className="flex justify-end">
            <div className="max-w-[75%] rounded-2xl rounded-br-md bg-parchment-dark px-4 py-2.5 text-[15px] whitespace-pre-wrap">
              {m.content}
            </div>
          </div>
        ) : (
          <div key={m.id} className="flex gap-3">
            <div className="w-7 h-7 shrink-0 rounded-full bg-accent-soft flex items-center justify-center mt-0.5">
              <Zap size={13} className="text-accent" fill="currentColor" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] leading-relaxed whitespace-pre-wrap">{m.content}</div>
              {artifact && (
                <Link
                  href={`/artifacts?open=${artifact.id}`}
                  className="mt-3 flex items-center gap-3 rounded-xl border border-line bg-card px-3.5 py-2.5 hover:border-ink-faint transition-colors max-w-sm"
                >
                  <div className="w-9 h-9 rounded-lg bg-accent-soft flex items-center justify-center">
                    <Package size={16} className="text-accent" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{artifact.title}</p>
                    <p className="text-[11px] text-ink-faint capitalize">{artifact.kind} · click to open</p>
                  </div>
                </Link>
              )}
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
