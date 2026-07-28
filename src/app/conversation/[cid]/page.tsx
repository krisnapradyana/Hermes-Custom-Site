"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft, FolderKanban, PanelRight, Lock, User, RefreshCw } from "lucide-react";
import { useHermesStore } from "@/lib/store";
import { hermesStream } from "@/lib/hermes-api";
import { beginLive, updateLive, endLive, getLive, subscribeLive } from "@/lib/conv-stream";
import { Conversation, Message, Attachment } from "@/lib/types";
import { MessageList } from "@/components/MessageList";
import { Composer } from "@/components/Composer";
import { WorkspacePanel } from "@/components/WorkspacePanel";
import { useResizableWidth, ResizeHandle } from "@/components/ResizeHandle";

let counter = 0;
const uid = (p: string) => `${p}-${Date.now()}-${counter++}`;

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
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(cid)}`, { cache: "no-store" });
      if (!res.ok) {
        setNotFound(true);
        return;
      }
      const { conversation } = (await res.json()) as { conversation: Conversation };
      setConv(conversation);
      // Don't clobber a live in-progress stream (this tab) or our own stream.
      if (!streamingRef.current && !getLive(cid)) setMessages(conversation.messages);
    } catch {
      setNotFound(true);
    }
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
    await fetch(`/api/conversations/${encodeURIComponent(cid)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: msgs, title }),
    }).catch(() => {});
  };

  const send = async (content: string, attachments: Attachment[]) => {
    if (!conv || streaming) return;
    const now = new Date().toISOString();
    const metaAtt: Attachment[] | undefined = attachments.length
      ? attachments.map((a) => ({ name: a.name, type: a.type, size: a.size }))
      : undefined;

    // Upload attachment bytes off the message body.
    const refs: Attachment[] = [];
    for (const a of attachments) {
      const base: Attachment = { name: a.name, type: a.type, size: a.size };
      try {
        const r = await fetch("/api/attachments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: a.name, type: a.type, dataUrl: a.dataUrl }),
        });
        if (r.ok) base.id = (await r.json()).id;
      } catch {}
      refs.push(base);
    }

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

    const context = project?.workingFolder
      ? `The user is working in project "${project.name}". Working folder: ${project.workingFolder} — ` +
        `the team's shared Drive, mounted on this machine. Read and save files there. Only CREATE ` +
        `new files; never delete, move, or overwrite — save versioned copies (name-v2.ext) instead.`
      : undefined;

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
        (st) => patch({ content: st.content, thinking: st.thinking }),
        context,
        conv.projectId
      );
      const done = withUser.map((m) =>
        m.id === asstId ? { ...m, content: final.content, thinking: final.thinking } : m
      );
      setMessages(done);
      await persist(done);
      endLive(cid, done);
    } catch {
      const errored = latest.map((m) =>
        m.id === asstId ? { ...m, content: "⚠️ The reply failed. Please try again." } : m
      );
      endLive(cid, errored);
    } finally {
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

  if (notFound) {
    return (
      <div className="flex h-full items-center justify-center text-ink-faint text-sm">
        Conversation not found.
      </div>
    );
  }
  if (!conv) {
    return <div className="flex h-full items-center justify-center text-ink-faint text-sm">Loading…</div>;
  }

  return (
    <div className="flex h-full">
      <div className="flex h-full flex-col flex-1 min-w-0">
        <header className="flex items-center justify-between border-b border-line bg-parchment/80 backdrop-blur px-6 py-3 sticky top-0 z-10">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={() => router.push(`/projects/${conv.projectId}`)}
              className="p-1.5 -ml-1.5 rounded-lg hover:bg-parchment-dark text-ink-soft shrink-0"
              title="Back to project"
            >
              <ArrowLeft size={16} />
            </button>
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
          </div>
          <div className="flex items-center gap-1">
            {!isOwner && (
              <span className="inline-flex items-center gap-1 rounded-full bg-parchment-dark px-2.5 py-1 text-[11px] text-ink-soft">
                <Lock size={11} /> Read-only
              </span>
            )}
            {!isOwner && (
              <button onClick={load} className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft" title="Refresh">
                <RefreshCw size={15} />
              </button>
            )}
            {project?.workingFolder && (
              <button
                onClick={() => setShowWorkspace(!showWorkspace)}
                className={`p-2 rounded-lg hover:bg-parchment-dark ${showWorkspace ? "text-accent" : "text-ink-soft"}`}
                title={showWorkspace ? "Hide workspace panel" : "Show workspace panel"}
              >
                <PanelRight size={15} />
              </button>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-6 py-8">
            <MessageList messages={messages} streaming={streaming} />
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="border-t border-line bg-parchment px-6 py-4">
          <div className="mx-auto max-w-3xl">
            {isOwner ? (
              <Composer onSend={send} disabled={streaming} />
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
          <div className="shrink-0 border-l border-line bg-card flex flex-col" style={{ width: ws.width }}>
            <WorkspacePanel project={project} />
          </div>
        </>
      )}
    </div>
  );
}
