"use client";

import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FolderKanban, Package } from "lucide-react";
import { useHermesStore } from "@/lib/store";
import { timeAgo } from "@/lib/format";
import { Composer } from "@/components/Composer";

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const project = useHermesStore((s) => s.projects.find((p) => p.id === id));
  const chats = useHermesStore((s) => s.chats.filter((c) => c.projectId === id));
  const artifacts = useHermesStore((s) =>
    s.artifacts.filter((a) => a.chatId && s.chats.some((c) => c.id === a.chatId && c.projectId === id))
  );
  const createChat = useHermesStore((s) => s.createChat);

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-ink-faint text-sm">
        Project not found.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <Link
        href="/projects"
        className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink mb-6"
      >
        <ArrowLeft size={14} />
        All projects
      </Link>

      <div className="flex items-center gap-3 mb-2">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: `${project.color}22` }}
        >
          <FolderKanban size={18} style={{ color: project.color }} />
        </div>
        <h1 className="font-serif-display text-3xl">{project.name}</h1>
      </div>
      <p className="text-ink-soft mb-8">{project.description}</p>

      <div className="mb-10">
        <Composer
          placeholder={`New conversation in ${project.name}…`}
          onSend={(t, a) => {
            const chatId = createChat(t, project.id, a);
            router.push(`/chat/${chatId}`);
          }}
        />
      </div>

      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-faint mb-3">
        Conversations
      </h2>
      <div className="space-y-2 mb-10">
        {chats.map((c) => (
          <Link
            key={c.id}
            href={`/chat/${c.id}`}
            className="block rounded-xl border border-line bg-card px-4 py-3 hover:border-ink-faint transition-colors"
          >
            <p className="text-sm font-medium">{c.title}</p>
            <p className="text-[12px] text-ink-faint">
              {c.messages.length} messages · updated {timeAgo(c.updatedAt)}
            </p>
          </Link>
        ))}
        {chats.length === 0 && (
          <p className="text-sm text-ink-faint">No conversations in this project yet.</p>
        )}
      </div>

      {artifacts.length > 0 && (
        <>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-faint mb-3">
            Artifacts
          </h2>
          <div className="space-y-2">
            {artifacts.map((a) => (
              <Link
                key={a.id}
                href={`/artifacts?open=${a.id}`}
                className="flex items-center gap-3 rounded-xl border border-line bg-card px-4 py-3 hover:border-ink-faint transition-colors"
              >
                <Package size={15} className="text-accent" />
                <div>
                  <p className="text-sm font-medium">{a.title}</p>
                  <p className="text-[12px] text-ink-faint capitalize">
                    {a.kind} · updated {timeAgo(a.updatedAt)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
