"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  PenSquare,
  Pin,
  PinOff,
  Trash2,
  FolderKanban,
  Package,
  Paperclip,
  GanttChart,
  AlarmClock,
  CalendarDays,
  History,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  Users,
} from "lucide-react";
import { useHermesStore } from "@/lib/store";
import { timeAgo } from "@/lib/format";
import { api } from "@/lib/api";
import { IconButton } from "@/components/ui";
import { Chat } from "@/lib/types";
import { useResizableWidth, ResizeHandle } from "@/components/ResizeHandle";
import { UserBadge } from "@/components/UserBadge";
import { BrandMark } from "@/components/BrandMark";
import { ThemeToggle } from "@/components/ThemeToggle";

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const chats = useHermesStore((s) => s.chats);
  const togglePin = useHermesStore((s) => s.togglePin);
  const deleteChat = useHermesStore((s) => s.deleteChat);
  const hydrated = useHermesStore((s) => s._hasHydrated);
  const [collapsed, setCollapsed] = useState(false);
  const { width, startResize } = useResizableWidth("hermes-sidebar-w", 288, 208, 480);

  // Chat search: matches titles and message content.
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * Search runs on the server: message bodies live in per-chat files now, and
   * scanning them here would mean downloading every message. Debounced so
   * typing doesn't fire a request per keystroke.
   */
  const [results, setResults] = useState<{ chat: Chat; snippet: string }[]>([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      const res = await api.get<{ results: { chat: Chat; snippet: string }[] }>(
        `/api/chats/search?q=${encodeURIComponent(q)}`
      );
      setResults(res.ok ? res.data.results : []);
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  // Rehydrate persisted state + load shared projects once on the client.
  useEffect(() => {
    useHermesStore.persist.rehydrate();
    useHermesStore.getState().loadProjects();
  }, []);

  const pinned = hydrated ? chats.filter((c) => c.pinned) : [];
  const recents = hydrated
    ? [...chats]
        .filter((c) => !c.pinned)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 12)
    : [];

  if (collapsed) {
    return (
      <aside className="w-13 shrink-0 border-r border-line bg-sidebar flex flex-col items-center py-3 gap-1.5">
        <IconButton onClick={() => setCollapsed(false)} title="Expand sidebar">
          <ChevronRight size={16} />
        </IconButton>
        {/* Team group */}
        <Link
          prefetch={false}
          href="/team"
          className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
          title="Team"
        >
          <Users size={16} />
        </Link>
        <Link
          prefetch={false}
          href="/projects"
          className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
          title="Projects"
        >
          <FolderKanban size={16} />
        </Link>
        <Link
          prefetch={false}
          href="/schedule"
          className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
          title="Schedule — all projects on one timeline"
        >
          <GanttChart size={16} />
        </Link>
        <Link
          prefetch={false}
          href="/events"
          className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
          title="Event — company calendar"
        >
          <CalendarDays size={16} />
        </Link>

        {/* Divider stands in for the group titles in the rail. */}
        <span className="w-6 border-b border-line my-1.5" />

        {/* Personal group */}
        <Link
          prefetch={false}
          href="/"
          className="p-2 rounded-lg hover:bg-parchment-dark text-accent"
          title="New chat"
        >
          <PenSquare size={16} />
        </Link>
        <Link
          prefetch={false}
          href="/artifacts"
          className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
          title="Artifacts"
        >
          <Package size={16} />
        </Link>
        <Link
          prefetch={false}
          href="/attachments"
          className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
          title="Attachments"
        >
          <Paperclip size={16} />
        </Link>
        <Link
          prefetch={false}
          href="/history"
          className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
          title="Agent history"
        >
          <History size={16} />
        </Link>
        <Link
          prefetch={false}
          href="/cron"
          className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
          title="Scheduler — automatic tasks the agent runs for you"
        >
          <AlarmClock size={16} />
        </Link>
      </aside>
    );
  }

  const navItem = (href: string, icon: React.ReactNode, label: string) => {
    const active = pathname === href || (href !== "/" && pathname.startsWith(href));
    return (
      <Link
        prefetch={false}
        href={href}
        className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors ${
          active
            ? "bg-accent-soft text-accent font-medium"
            : "text-ink hover:bg-black/5 dark:hover:bg-white/10"
        }`}
      >
        <span className="text-accent">{icon}</span>
        {label}
      </Link>
    );
  };

  return (
    <>
      <aside className="shrink-0 border-r border-line bg-sidebar flex flex-col" style={{ width }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <Link prefetch={false} href="/" className="min-w-0">
            <BrandMark size={22} />
          </Link>
          <button
            onClick={() => setCollapsed(true)}
            className="p-1.5 rounded-lg hover:bg-parchment-dark text-ink-faint shrink-0"
            title="Collapse sidebar"
          >
            <ChevronLeft size={15} />
          </button>
        </div>

        {/* Nav — grouped: shared TEAM surfaces first, then PERSONAL ones. */}
        <div className="mx-3 mb-2 rounded-xl bg-black/[0.04] dark:bg-white/[0.04] p-1.5 space-y-0.5">
          <div className="px-2.5 pt-1">
            <p className="text-left text-[10.5px] font-medium uppercase tracking-wider text-ink-faint">
              Team
            </p>
            <div className="border-b border-line mt-1" />
          </div>
          {navItem("/team", <Users size={15} />, "Team")}
          {navItem("/projects", <FolderKanban size={15} />, "Projects")}
          {navItem("/schedule", <GanttChart size={15} />, "Schedule")}
          {navItem("/events", <CalendarDays size={15} />, "Event")}

          <div className="px-2.5 pt-2.5">
            <p className="text-left text-[10.5px] font-medium uppercase tracking-wider text-ink-faint">
              Personal
            </p>
            <div className="border-b border-line mt-1" />
          </div>
          <button
            onClick={() => router.push("/")}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium text-accent hover:bg-accent-soft transition-colors"
          >
            <PenSquare size={15} />
            New chat
          </button>
          {navItem("/artifacts", <Package size={15} />, "Artifacts")}
          {navItem("/attachments", <Paperclip size={15} />, "Attachments")}
          {navItem("/history", <History size={15} />, "Agent history")}
          {navItem("/cron", <AlarmClock size={15} />, "Scheduler")}
        </div>

        {/* Search */}
        <div className="mx-3 mb-1 relative">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
          />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery("");
                e.currentTarget.blur();
              }
            }}
            placeholder="Search chats…  (Ctrl+K)"
            className="w-full rounded-lg border border-line bg-transparent pl-8 pr-7 py-1.5 text-[13px] outline-none focus:border-ink-faint placeholder:text-ink-faint"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
              title="Clear"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Chat lists */}
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {q ? (
            <ChatSection title={`Results (${results.length})`} icon={<Search size={11} />}>
              {results.map(({ chat: c, snippet }) => (
                <ChatLink
                  key={c.id}
                  id={c.id}
                  title={c.title}
                  subtitle={snippet || timeAgo(c.updatedAt)}
                  active={pathname === `/chat/${c.id}`}
                  pinned={c.pinned}
                  onPin={() => togglePin(c.id)}
                  onDelete={() => {
                    deleteChat(c.id);
                    if (pathname === `/chat/${c.id}`) router.push("/");
                  }}
                />
              ))}
              {results.length === 0 && (
                <p className="px-2.5 py-1 text-xs text-ink-faint">
                  {searching ? "Searching…" : `No chats match “${query}”.`}
                </p>
              )}
            </ChatSection>
          ) : (
            <>
              {pinned.length > 0 && (
                <ChatSection title="Pinned" icon={<Pin size={11} />}>
                  {pinned.map((c) => (
                    <ChatLink
                      key={c.id}
                      id={c.id}
                      title={c.title}
                      active={pathname === `/chat/${c.id}`}
                      pinned
                      onPin={() => togglePin(c.id)}
                      onDelete={() => {
                        deleteChat(c.id);
                        if (pathname === `/chat/${c.id}`) router.push("/");
                      }}
                    />
                  ))}
                </ChatSection>
              )}

              <ChatSection title="Recents" icon={<MessageSquare size={11} />}>
                {recents.map((c) => (
                  <ChatLink
                    key={c.id}
                    id={c.id}
                    title={c.title}
                    subtitle={timeAgo(c.updatedAt)}
                    active={pathname === `/chat/${c.id}`}
                    pinned={false}
                    onPin={() => togglePin(c.id)}
                    onDelete={() => {
                      deleteChat(c.id);
                      if (pathname === `/chat/${c.id}`) router.push("/");
                    }}
                  />
                ))}
                {hydrated && recents.length === 0 && pinned.length === 0 && (
                  <p className="px-2.5 py-1 text-xs text-ink-faint">
                    No conversations yet — start one above.
                  </p>
                )}
              </ChatSection>
            </>
          )}
        </div>

        {/* Footer: signed-in user + theme toggle */}
        <div className="border-t border-line px-4 py-3 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <UserBadge />
          </div>
          <ThemeToggle />
        </div>
      </aside>
      <ResizeHandle onPointerDown={startResize} />
    </>
  );
}

function ChatSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <div className="flex items-center gap-1.5 px-2.5 mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        {icon}
        {title}
      </div>
      <div className="space-y-px">{children}</div>
    </div>
  );
}

function ChatLink({
  id,
  title,
  subtitle,
  active,
  pinned,
  onPin,
  onDelete,
}: {
  id: string;
  title: string;
  subtitle?: string;
  active: boolean;
  pinned?: boolean;
  onPin?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="relative group">
      <Link
        prefetch={false}
        href={`/chat/${id}`}
        className={`block px-2.5 py-1.5 rounded-lg transition-colors ${
          active ? "bg-parchment-dark" : "hover:bg-parchment-dark"
        }`}
      >
        <p className="text-sm truncate text-ink pr-12">{title}</p>
        {subtitle && <p className="text-[11px] text-ink-faint">{subtitle}</p>}
      </Link>
      <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {onPin && (
          <button
            onClick={(e) => {
              e.preventDefault();
              onPin();
            }}
            className="p-1 rounded-md hover:bg-parchment text-ink-faint hover:text-ink"
            title={pinned ? "Unpin" : "Pin"}
          >
            {pinned ? <PinOff size={13} /> : <Pin size={13} />}
          </button>
        )}
        {onDelete && (
          <button
            onClick={(e) => {
              e.preventDefault();
              onDelete();
            }}
            className="p-1 rounded-md hover:bg-parchment text-ink-faint hover:text-red-500"
            title="Delete chat"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
