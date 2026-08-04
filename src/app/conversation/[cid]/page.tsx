"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft, FolderKanban, PanelRight, Lock, User, RefreshCw } from "lucide-react";
import { useHermesStore } from "@/lib/store";
import { hermesStream, rehydrateAttachments, StoppedError } from "@/lib/hermes-api";
import { beginLive, updateLive, endLive, getLive, subscribeLive } from "@/lib/conv-stream";
import {
  buildAgentContext,
  uploadAttachments,
  attachmentMeta,
  turnErrorMessage,
  abortControllers,
  stopTurn,
} from "@/lib/send-turn";
import { uid } from "@/lib/uid";
import { api } from "@/lib/api";
import { Conversation, Message, Attachment } from "@/lib/types";
import { MessageList } from "@/components/MessageList";
import { Composer } from "@/components/Composer";
import { WorkspacePanel } from "@/components/WorkspacePanel";
import { useResizableWidth, ResizeHandle } from "@/components/ResizeHandle";
import { TokenMeter } from "@/components/TokenMeter";
import { IconButton, EmptyState, ScreenHeader, SidePanel } from "@/components/ui";

export default function ConversationPage({ params }: { params: Promise<{ cid: string }> }) {
  const { cid } = use(params);
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const projects = useHermesStore((s) => s.projects);
  const loadProjects = useHermesStore((s) => s.loadProjects);

  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [showWorkspace, setShowWorkspace] = useState(true);
  const ws = useResizableWidth("hermes-workspace-w", 320, 240, 640, true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Guard: never let a background refresh clobber an in-progress exchange.
  const streamingRef = useRef(false);
  const load = useCallback(async () => {
    const res = await api.get<{ conversation: Conversation }>(
      `/api/conversations/${encodeURIComponent(cid)}`
    );
    if (!res.ok) {
      setNotFound(true);
      return;
    }
    setConv(res.data.conversation);
    // Don't clobber a live in-progress stream (this tab) or our own stream.
    if (!streamingRef.current && !getLive(cid)) setMessages(res.data.conversation.messages);
  }, [cid]);

  useEffect(() => {
    load();
  }, [load]);

  // Re-attach to an in-flight stream when returning to this conversation.
  useEffect(() => {
    const snapshot = getLive(cid);
    if (snapshot) {
      setMessages(snapshot.messages);
      setStreaming(snapshot.streaming);
      streamingRef.current = snapshot.streaming;
    }
    const unsub = subscribeLive(cid, (m, s) => {
      setMessages(m);
      setStreaming(s);
      streamingRef.current = s;
    });
    return unsub;
  }, [cid]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streaming]);

  const project = conv ? projects.find((p) => p.id === conv.projectId) : undefined;
  // Until the session resolves, assume the viewer IS the owner — assuming
  // otherwise would start the refresh poll and wipe in-progress messages.
  const sessionReady = sessionStatus !== "loading";
  const isOwner =
    !conv?.createdBy?.slackId ||
    !sessionReady ||
    session?.user?.slackId === conv.createdBy?.slackId;

  // Non-owners poll so they see new messages the owner adds.
  useEffect(() => {
    if (!sessionReady || isOwner || !conv) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible" && !streamingRef.current) load();
    }, 6000);
    return () => clearInterval(t);
  }, [sessionReady, isOwner, conv, load]);

  const persist = async (msgs: Message[], title?: string) => {
    const res = await api.put(`/api/conversations/${encodeURIComponent(cid)}`, {
      messages: msgs,
      title,
    });
    if (!res.ok) console.warn(`[conversation] save failed: ${res.error}`);
  };

  const send = async (content: string, attachments: Attachment[], mentions?: string[]) => {
    if (!conv || streaming) return;
    const now = new Date().toISOString();
    const metaAtt = attachmentMeta(attachments);
    // Upload attachment bytes off the message body (shared implementation).
    const refs = await uploadAttachments(attachments);

    const userMsg: Message = { id: uid("m"), role: "user", content, createdAt: now, attachments: metaAtt };
    const asstId = uid("m");
    const asstMsg: Message = { id: asstId, role: "assistant", content: "", thinking: "", createdAt: now };
    const storedUser = { ...userMsg, attachments: refs.length ? refs : undefined };
    const withUser = [...messages, storedUser, asstMsg];
    setMessages(withUser);
    streamingRef.current = true;
    setStreaming(true);
    beginLive(cid, withUser); // register so navigating away/back keeps the stream
    // Save the user's message right away so a refresh mid-reply doesn't lose it.
    persist([...messages, storedUser], messages.length === 0 ? content : undefined);

    // Shared context builder — "@" mentions become absolute paths the agent
    // reads straight from the mounted Drive (nothing is uploaded).
    const context = buildAgentContext(project, mentions);

    const controller = new AbortController();
    abortControllers.set(cid, controller);

    // Drive updates through the live registry so any mounted copy of this
    // page (after navigating back) stays in sync with the running stream.
    let latest = withUser;
    const patch = (patchObj: Partial<Message>) => {
      latest = latest.map((m) => (m.id === asstId ? { ...m, ...patchObj } : m));
      setMessages(latest); // this (sending) instance
      updateLive(cid, latest); // any re-mounted instance after navigating back
    };

    try {
      const final = await hermesStream(
        content,
        messages,
        attachments,
        cid,
        (st) =>
          patch({
            content: st.content,
            thinking: st.thinking,
            status: st.status,
            idleMs: st.idleMs,
            state: "working",
          }),
        context,
        conv.projectId,
        controller.signal
      );
      const done = withUser.map((m) =>
        m.id === asstId
          ? {
              ...m,
              content: final.content,
              thinking: final.thinking,
              status: undefined,
              idleMs: undefined,
              state: "done" as const,
            }
          : m
      );
      setMessages(done);
      await persist(done);
      endLive(cid, done);
    } catch (err) {
      const stopped = err instanceof StoppedError;
      const errored = latest.map((m) =>
        m.id === asstId
          ? {
              ...m,
              content: stopped ? "⏹ Stopped." : turnErrorMessage(err),
              status: undefined,
              idleMs: undefined,
              state: (stopped ? "done" : "failed") as "done" | "failed",
              retryOf: stopped ? undefined : content,
              retryAttachments: stopped || !refs.length ? undefined : refs,
            }
          : m
      );
      setMessages(errored);
      await persist(errored);
      endLive(cid, errored);
    } finally {
      abortControllers.delete(cid);
      streamingRef.current = false;
      setStreaming(false);
      load(); // refresh metadata (title/counts) from the server
    }
  };

  // Auto-send the first message carried over from the project composer.
  const sentPending = useRef(false);
  useEffect(() => {
    if (!conv || !isOwner || sentPending.current || messages.length > 0) return;
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem(`pending-msg-${cid}`);
      if (pending) sessionStorage.removeItem(`pending-msg-${cid}`);
    } catch {}
    if (pending) {
      sentPending.current = true;
      send(pending, []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv, isOwner, messages.length]);

  if (notFound) return <EmptyState>Conversation not found.</EmptyState>;
  if (!conv) return <EmptyState>Loading…</EmptyState>;

  return (
    <div className="flex h-full">
      <div className="flex h-full flex-col flex-1 min-w-0">
        <ScreenHeader
          left={
            <>
              <IconButton
                onClick={() => router.push(`/projects/${conv.projectId}`)}
                title="Back to project"
                className="-ml-1.5 shrink-0"
              >
                <ArrowLeft size={16} />
              </IconButton>
              <div className="min-w-0">
                <h1 className="text-[15px] font-medium truncate">{conv.title}</h1>
                <div className="flex items-center gap-2 text-[11px] text-ink-faint">
                  {project && (
                    <span className="inline-flex items-center gap-1">
                      <FolderKanban size={10} />
                      {project.name}
                    </span>
                  )}
                  {conv.createdBy?.name && (
                    <span className="inline-flex items-center gap-1">
                      <User size={10} />
                      {conv.createdBy.name}
                    </span>
                  )}
                </div>
              </div>
            </>
          }
          right={
            <>
              <TokenMeter sessionId={cid} refreshKey={streaming ? "live" : messages.length} />
              {!isOwner && (
                <>
                  <span className="inline-flex items-center gap-1 rounded-full bg-parchment-dark px-2.5 py-1 text-[11px] text-ink-soft">
                    <Lock size={11} /> Read-only
                  </span>
                  <IconButton onClick={load} title="Refresh">
                    <RefreshCw size={15} />
                  </IconButton>
                </>
              )}
              {project?.workingFolder && (
                <IconButton
                  onClick={() => setShowWorkspace(!showWorkspace)}
                  active={showWorkspace}
                  title={showWorkspace ? "Hide workspace panel" : "Show workspace panel"}
                >
                  <PanelRight size={15} />
                </IconButton>
              )}
            </>
          }
        />

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-6 py-8">
            <MessageList
              messages={messages}
              streaming={streaming}
              onRetry={
                isOwner
                  ? async (text, atts) => send(text, await rehydrateAttachments(atts))
                  : undefined
              }
            />
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="border-t border-line bg-parchment px-6 py-4">
          <div className="mx-auto max-w-3xl">
            {isOwner ? (
              <Composer
                onSend={send}
                disabled={streaming}
                projectId={conv.projectId}
                onStop={() => stopTurn(cid)}
              />
            ) : (
              <p className="text-center text-[13px] text-ink-faint py-2">
                This conversation is read-only — only {conv.createdBy?.name ?? "the creator"} can reply.
              </p>
            )}
          </div>
        </div>
      </div>

      {project?.workingFolder && showWorkspace && (
        <>
          <ResizeHandle onPointerDown={ws.startResize} />
          <SidePanel width={ws.width}>
            <WorkspacePanel project={project} />
          </SidePanel>
        </>
      )}
    </div>
  );
}
