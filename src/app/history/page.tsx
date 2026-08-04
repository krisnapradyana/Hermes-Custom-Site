"use client";

import { useCallback, useEffect, useState } from "react";
import { History, RefreshCw, ChevronDown, ChevronRight, MessageSquare } from "lucide-react";
import { timeAgo } from "@/lib/format";
import { useHermesStore } from "@/lib/store";
import { api } from "@/lib/api";
import { IconButton } from "@/components/ui";

/**
 * Phase 4b: read-only view of the agent's real session history from Hermes
 * (/api/sessions) — includes conversations that happened in Slack, the CLI,
 * or this web UI.
 */

interface SessionView {
  id: string;
  title: string;
  source?: string;
  updatedAt?: string;
  raw: Record<string, unknown>;
}

interface MessageView {
  role: string;
  content: string;
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

function mapSession(s: Record<string, unknown>): SessionView {
  return {
    id: str(s.id) ?? str(s.session_id) ?? JSON.stringify(s).slice(0, 24),
    title: str(s.title) ?? str(s.name) ?? str(s.id) ?? "session",
    source: str(s.source) ?? str(s.platform) ?? str(s.origin),
    updatedAt: str(s.updated_at) ?? str(s.updatedAt) ?? str(s.last_active) ?? str(s.created_at),
    raw: s,
  };
}

function extractList(data: unknown, key: string): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  const obj = data as Record<string, unknown>;
  return (
    (obj?.[key] as Record<string, unknown>[]) ??
    (obj?.data as Record<string, unknown>[]) ??
    (obj?.items as Record<string, unknown>[]) ??
    []
  );
}

function mapMessage(m: Record<string, unknown>): MessageView {
  let content = str(m.content) ?? str(m.text) ?? str(m.message) ?? "";
  if (!content && Array.isArray(m.content)) {
    content = (m.content as Record<string, unknown>[]).map((p) => str(p.text) ?? "").join("");
  }
  return { role: str(m.role) ?? str(m.sender) ?? "unknown", content };
}

/** Machine-generated titles like "chat-1784226101672-0" aren't human-readable. */
function isUglyTitle(title: string, id: string): boolean {
  return (
    !title ||
    title === id ||
    /^(chat|session|run)[-_]?\d{6,}/i.test(title) ||
    /^[0-9a-f-]{16,}$/i.test(title)
  );
}

function titleFromMessages(msgs: MessageView[]): string | null {
  const firstUser = msgs.find((m) => m.role === "user" && m.content.trim());
  if (!firstUser) return null;
  const clean = firstUser.content.replace(/\s+/g, " ").trim();
  return clean.length > 60 ? clean.slice(0, 57) + "…" : clean;
}

const SOURCE_LABELS: Record<string, string> = {
  api_server: "Web",
  slack: "Slack",
  cron: "Scheduled",
  cli: "CLI",
  tui: "CLI",
};

const sourceLabel = (s?: string) => (s ? (SOURCE_LABELS[s.toLowerCase()] ?? s) : undefined);

export default function HistoryPage() {
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, MessageView[]>>({});
  const [loadingMsgs, setLoadingMsgs] = useState("");

  // Only show sessions that belong to THIS user. Hermes doesn't record a
  // per-user owner (user_id is null), but our web sessions share their id
  // with the user's own chats — so we match on that.
  const chats = useHermesStore((s) => s.chats);

  const refresh = useCallback(async () => {
    setError("");
    const res = await api.get<unknown>("/api/agent-sessions");
    if (!res.ok) {
      setError(res.error);
    } else {
      const myIds = new Set(useHermesStore.getState().chats.map((c) => c.id));
      const list = extractList(res.data, "sessions")
        .map(mapSession)
        .filter((s) => myIds.has(s.id));
      setSessions(list);
      autoTitle(list);
    }
    setLoading(false);
  }, []);

  /**
   * Replace machine titles ("chat-1784...") with the session's first user
   * message, and persist the readable title back to Hermes via PATCH so
   * it's fixed permanently for every client.
   */
  const autoTitle = async (list: SessionView[]) => {
    const targets = list.filter((s) => isUglyTitle(s.title, s.id)).slice(0, 15);
    await Promise.all(
      targets.map(async (s) => {
        const res = await api.get<unknown>(`/api/agent-sessions/${encodeURIComponent(s.id)}`);
        if (!res.ok) {
          console.warn(`[history] load session failed: ${res.error}`);
          return;
        }
        const msgs = extractList(res.data, "messages").map(mapMessage);
        setMessages((prev) => ({ ...prev, [s.id]: msgs }));
        const title = titleFromMessages(msgs);
        if (!title) return;
        setSessions((prev) => prev.map((x) => (x.id === s.id ? { ...x, title } : x)));
        // Best-effort: persist upstream so the title sticks.
        void api.patch(`/api/agent-sessions/${encodeURIComponent(s.id)}`, { title }).then((r) => {
          if (!r.ok) console.warn(`[history] title patch failed: ${r.error}`);
        });
      })
    );
  };

  // Re-run when chats hydrate/change so the owned-session filter is accurate.
  useEffect(() => {
    refresh();
  }, [refresh, chats.length]);

  const toggle = async (id: string) => {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    if (!messages[id]) {
      setLoadingMsgs(id);
      const res = await api.get<unknown>(`/api/agent-sessions/${encodeURIComponent(id)}`);
      if (!res.ok) {
        console.warn(`[history] load messages failed: ${res.error}`);
        setMessages((prev) => ({ ...prev, [id]: [] }));
      } else {
        setMessages((prev) => ({
          ...prev,
          [id]: extractList(res.data, "messages").map(mapMessage),
        }));
      }
      setLoadingMsgs("");
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif-display text-3xl mb-1">Agent history</h1>
          <p className="text-sm text-ink-soft">Your past conversations with the agent.</p>
        </div>
        <IconButton onClick={refresh} title="Refresh">
          <RefreshCw size={15} />
        </IconButton>
      </div>

      {loading && <p className="text-sm text-ink-faint">Loading sessions…</p>}
      {error && (
        <p className="text-sm text-red-500 mb-4">{error} — is the Hermes gateway running?</p>
      )}

      <div className="space-y-2">
        {sessions.map((s) => (
          <div key={s.id} className="rounded-xl border border-line bg-card">
            <button
              onClick={() => toggle(s.id)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left"
            >
              {openId === s.id ? (
                <ChevronDown size={14} className="text-ink-faint shrink-0" />
              ) : (
                <ChevronRight size={14} className="text-ink-faint shrink-0" />
              )}
              <History size={14} className="text-accent shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{s.title}</p>
                <p className="text-[11px] text-ink-faint">
                  {[sourceLabel(s.source), s.updatedAt ? timeAgo(s.updatedAt) : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            </button>

            {openId === s.id && (
              <div className="border-t border-line px-4 py-3 space-y-3 max-h-96 overflow-y-auto">
                {loadingMsgs === s.id && (
                  <p className="text-xs text-ink-faint">Loading messages…</p>
                )}
                {messages[s.id]?.map((m, i) => (
                  <div key={i} className="flex gap-2.5">
                    <MessageSquare
                      size={13}
                      className={`mt-1 shrink-0 ${
                        m.role === "user" ? "text-ink-faint" : "text-accent"
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-wide text-ink-faint">{m.role}</p>
                      <p className="text-[13px] whitespace-pre-wrap break-words">
                        {m.content.slice(0, 2000) || "(no text)"}
                      </p>
                    </div>
                  </div>
                ))}
                {messages[s.id]?.length === 0 && loadingMsgs !== s.id && (
                  <p className="text-xs text-ink-faint">No messages in this session.</p>
                )}
              </div>
            )}
          </div>
        ))}
        {!loading && !error && sessions.length === 0 && (
          <p className="text-sm text-ink-faint">No conversations yet.</p>
        )}
      </div>
    </div>
  );
}
