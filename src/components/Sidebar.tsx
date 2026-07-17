"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  PenSquare,
  Pin,
  PinOff,
  Trash2,
  FolderKanban,
  Package,
  Clock,
  History,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useHermesStore } from "@/lib/store";
import { timeAgo } from "@/lib/format";
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

  // Rehydrate persisted state once on the client (skipHydration is on).
  useEffect(() => {
    useHermesStore.persist.rehydrate();
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
        <button
          onClick={() => setCollapsed(false)}
          className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
          title="Expand sidebar"
        >
          <ChevronRight size={16} />
        </button>
        <Link href="/" className="p-2 rounded-lg hover:bg-parchment-dark text-accent" title="New chat">
          <PenSquare size={16} />
        </Link>
        <Link href="/projects" className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft" title="Projects">
          <FolderKanban size={16} />
        </Link>
        <Link href="/artifacts" className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft" title="Artifacts">
          <Package size={16} />
        </Link>
        <Link href="/cron" className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft" title="Scheduler">
          <Clock size={16} />
        </Link>
        <Link href="/history" className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft" title="Agent history">
          <History size={16} />
        </Link>
      </aside>
    );
  }

  const navItem = (href: string, icon: React.ReactNode, label: string) => {
    const active = pathname === href || (href !== "/" && pathname.startsWith(href));
    return (
      <Link
        href={href}
        className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors ${
          active ? "bg-accent-soft text-accent-hover font-medium" : "text-ink-soft hover:bg-parchment-dark"
        }`}
      >
        {icon}
        {label}
      </Link>
    );
  };

  return (
    <aside className="w-72 shrink-0 border-r border-line bg-sidebar flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <Link href="/" className="min-w-0">
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

      {/* New chat + nav */}
      <div className="px-3 pb-2 space-y-0.5">
        <button
          onClick={() => router.push("/")}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium text-accent hover:bg-accent-soft transition-colors"
        >
          <PenSquare size={15} />
          New chat
        </button>
        {navItem("/projects", <FolderKanban size={15} />, "Projects")}
        {navItem("/artifacts", <Package size={15} />, "Artifacts")}
        {navItem("/cron", <Clock size={15} />, "Scheduler")}
        {navItem("/history", <History size={15} />, "Agent history")}
      </div>

      {/* Chat lists */}
      <div className="flex-1 overflow-y-auto px-3 pb-4">
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
      </div>

      {/* Footer: signed-in user + theme toggle */}
      <div className="border-t border-line px-4 py-3 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <UserBadge />
        </div>
        <ThemeToggle />
      </div>
    </aside>
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
