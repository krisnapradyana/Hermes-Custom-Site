"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Package,
  FileText,
  ChevronDown,
  ChevronRight,
  BrainCircuit,
  TriangleAlert,
  RotateCw,
  Loader2,
  Download,
  ShieldAlert,
} from "lucide-react";
import { Message, Attachment } from "@/lib/types";
import { api } from "@/lib/api";
import { useHermesStore } from "@/lib/store";
import { renderMarkdown } from "@/lib/markdown";
import { extractFilePaths } from "@/lib/file-paths";
import { PixelMark } from "@/components/PixelMark";

/**
 * Server file paths the agent mentions in a reply (its Drive mount or its
 * own output dir) become download chips, so "the file is at /opt/data/x.docx"
 * is one click instead of a dead end. Detection lives in lib/file-paths so
 * the project Artifacts tab sees exactly the same files.
 */

function FileChips({ text }: { text: string }) {
  const paths = useMemo(() => extractFilePaths(text), [text]);
  if (paths.length === 0) return null;
  return (
    <div className="mt-2.5 flex flex-wrap gap-2">
      {paths.map((p) => {
        const dir = p.slice(0, p.lastIndexOf("/")) || "/";
        const name = p.slice(p.lastIndexOf("/") + 1);
        return (
          <a
            key={p}
            href={`/api/fs/download?root=${encodeURIComponent(dir)}&sub=${encodeURIComponent(name)}`}
            className="flex items-center gap-2 rounded-xl border border-line bg-card px-3 py-2 hover:border-ink-faint transition-colors max-w-full"
            title={p}
          >
            <div className="w-7 h-7 rounded-lg bg-accent-soft flex items-center justify-center shrink-0">
              <Download size={13} className="text-accent" />
            </div>
            <span className="text-[12px] font-medium truncate">{name}</span>
          </a>
        );
      })}
    </div>
  );
}

export function MessageList({
  messages,
  streaming,
  onOpenArtifact,
  onRetry,
}: {
  messages: Message[];
  streaming: boolean;
  onOpenArtifact?: (artifactId: string) => void;
  onRetry?: (text: string, attachments?: Attachment[]) => void;
}) {
  const artifacts = useHermesStore((s) => s.artifacts);

  return (
    <div className="space-y-6">
      {messages.map((m, idx) => {
        const artifact = m.artifactId ? artifacts.find((a) => a.id === m.artifactId) : undefined;
        const isLast = idx === messages.length - 1;
        const isPendingAssistant =
          m.role === "assistant" && !m.content && !m.thinking && streaming && isLast;

        return m.role === "user" ? (
          <div key={m.id} className="flex justify-end">
            <div className="max-w-[75%] space-y-2">
              {m.attachments && m.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 justify-end">
                  {m.attachments.map((a, i) =>
                    a.type.startsWith("image/") && (a.dataUrl || a.id) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={i}
                        src={a.dataUrl ?? `/api/attachments/${a.id}`}
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
          <div key={m.id} className="flex gap-2.5">
            <div className="shrink-0 mt-[1px]">
              <PixelMark size={24} thinking={streaming && isLast} />
            </div>
            <div className="min-w-0 flex-1">
              {m.thinking && (
                <ThinkingBlock text={m.thinking} live={streaming && isLast && !m.content} />
              )}

              {/* Live activity line — what the agent is doing right now. */}
              {streaming && isLast && m.role === "assistant" && (
                <StatusLine status={m.status} idleMs={m.idleMs} hasText={!!m.content} />
              )}

              {/* Approval gate: the agent is blocked on a human decision. */}
              {streaming && isLast && m.role === "assistant" && m.approval && m.runId && (
                <ApprovalCard
                  key={m.approval.patternKey ?? m.approval.command ?? "appr"}
                  approval={m.approval}
                  runId={m.runId}
                />
              )}

              {isPendingAssistant && !m.status ? (
                <div className="flex items-center gap-1.5 h-[26px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-ink-faint animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-ink-faint animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-ink-faint animate-bounce [animation-delay:300ms]" />
                </div>
              ) : (
                m.content && (
                  <>
                    <div
                      className="md-body text-[15px] leading-relaxed"
                      // Safe: renderMarkdown escapes all input before transforming.
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
                    />
                    <FileChips text={m.content} />
                  </>
                )
              )}

              {/* Failed turn — offer a retry. */}
              {m.state === "failed" && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2">
                  <TriangleAlert size={13} className="text-red-500 shrink-0" />
                  <span className="text-[12px] text-ink-soft flex-1">
                    This reply didn&apos;t complete.
                  </span>
                  {onRetry && m.retryOf && (
                    <button
                      onClick={() => onRetry(m.retryOf!, m.retryAttachments)}
                      className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[12px] text-white hover:bg-accent-hover"
                      title={
                        m.retryAttachments?.length
                          ? `Resend with ${m.retryAttachments.length} attachment(s)`
                          : "Resend this message"
                      }
                    >
                      <RotateCw size={11} /> Retry
                    </button>
                  )}
                </div>
              )}

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
                    prefetch={false}
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
    </div>
  );
}

/** One shared answer to "may I approve?" — fetched once per page life. */
let approverCache: boolean | null = null;

/**
 * Approval card — a guarded command is waiting on an engineer. Buttons come
 * from the event's own choices (observed: once/session/deny) and resolve via
 * POST /api/hermes/approval; non-approvers see a waiting state. The card
 * clears itself when the stream delivers approval.responded.
 */
function ApprovalCard({
  approval,
  runId,
}: {
  approval: NonNullable<Message["approval"]>;
  runId: string;
}) {
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [canApprove, setCanApprove] = useState<boolean | null>(approverCache);

  useEffect(() => {
    if (approverCache !== null) return;
    api.get<{ approver: boolean }>("/api/hermes/approval").then((res) => {
      approverCache = res.ok ? res.data.approver : false;
      setCanApprove(approverCache);
    });
  }, []);

  const choices = approval.choices?.length ? approval.choices : ["once", "deny"];
  const LABELS: Record<string, string> = {
    once: "Approve once",
    session: "Approve for this session",
    always: "Always allow",
    deny: "Deny",
  };

  const resolve = async (choice: string) => {
    setSending(choice);
    setError("");
    const res = await api.post("/api/hermes/approval", { runId, choice });
    if (!res.ok) {
      setError(res.error);
      setSending(null);
    }
    // On success the card stays in "sent" state until the stream clears it.
  };

  return (
    <div className="mb-2 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3">
      <div className="flex items-center gap-2 mb-1.5">
        <ShieldAlert size={15} className="text-amber-500 shrink-0" />
        <p className="text-[13px] font-medium">Guarded command — approval needed</p>
      </div>
      {approval.description && (
        <p className="text-[12.5px] text-ink-soft mb-1.5 whitespace-pre-wrap">
          {approval.description}
        </p>
      )}
      {approval.command && (
        <pre className="mb-2.5 rounded-lg bg-parchment-dark px-3 py-2 text-[12px] font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
          {approval.command}
        </pre>
      )}

      {canApprove === false && (
        <p className="flex items-center gap-1.5 text-[12.5px] text-ink-soft">
          <Loader2 size={12} className="animate-spin text-amber-500" />
          Waiting for an engineer to approve…
        </p>
      )}
      {canApprove === null && <p className="text-[12px] text-ink-faint">Checking permissions…</p>}

      {canApprove === true &&
        (sending && !error ? (
          <p className="flex items-center gap-1.5 text-[12.5px] text-ink-soft">
            <Loader2 size={12} className="animate-spin text-accent" />
            {sending === "deny" ? "Denying…" : "Approved — the agent is continuing…"}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {choices
              .filter((c) => c !== "deny")
              .map((c) => (
                <button
                  key={c}
                  onClick={() => resolve(c)}
                  className={`rounded-lg px-3.5 py-1.5 text-[12.5px] font-medium transition-colors ${
                    c === "once"
                      ? "bg-accent text-white hover:bg-accent-hover"
                      : "border border-line bg-card hover:border-ink-faint"
                  }`}
                  title={c === "session" ? "Allow this pattern for the rest of this session" : undefined}
                >
                  {LABELS[c] ?? c}
                </button>
              ))}
            {choices.includes("deny") && (
              <button
                onClick={() => resolve("deny")}
                className="rounded-lg border border-red-500/40 px-3.5 py-1.5 text-[12.5px] font-medium text-red-500 hover:bg-red-500/10 transition-colors"
              >
                Deny
              </button>
            )}
          </div>
        ))}
      {error && <p className="mt-1.5 text-[12px] text-red-500">{error}</p>}
    </div>
  );
}

/** Gemini-style live status: says what's happening, and flags quiet stretches. */
function StatusLine({
  status,
  idleMs,
  hasText,
}: {
  status?: string;
  idleMs?: number;
  hasText: boolean;
}) {
  if (!status) return null;
  // Once the answer is streaming in, the text itself is the signal.
  if (hasText && status === "Writing the answer…") return null;
  const quietSec = idleMs && idleMs > 20000 ? Math.round(idleMs / 1000) : 0;
  return (
    <div className="flex items-center gap-1.5 mb-1.5 text-[12px] text-ink-soft">
      <Loader2 size={12} className="animate-spin text-accent shrink-0" />
      <span>{status}</span>
      {quietSec > 0 && (
        <span className="text-ink-faint">· still working, quiet for {quietSec}s</span>
      )}
    </div>
  );
}

function ThinkingBlock({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  const show = open || live;

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[12px] text-ink-faint hover:text-ink-soft transition-colors"
      >
        <BrainCircuit size={12} className={live ? "animate-pulse text-accent" : ""} />
        {live ? "Thinking…" : "Thinking"}
        {show ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {show && (
        <pre className="mt-1.5 rounded-lg border border-line bg-parchment-dark/50 px-3 py-2 text-[12px] leading-relaxed text-ink-soft whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">
          {text}
        </pre>
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
