"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ChevronRight } from "lucide-react";
import { useHermesStore } from "@/lib/store";
import { Composer } from "@/components/Composer";
import { Attachment } from "@/lib/types";

/**
 * Chat home — UI-refresh prototype, modeled on the Figma "Default interface"
 * frame: time-of-day greeting with the member's first name, one-line promise,
 * composer, and three starter cards instead of suggestion chips.
 */

type Starter = { title: string; desc: string; prompt: string };
const STARTER_SETS: Starter[][] = [
  [
    {
      title: "Find what matters",
      desc: "Find the right document, without the endless searching.",
      prompt: "Help me find a document — I'll describe what I remember about it.",
    },
    {
      title: "Turn ideas into action",
      desc: "Brainstorm a campaign or shape your next project brief.",
      prompt: "Let's brainstorm — I have a rough idea I want to shape into a plan.",
    },
    {
      title: "Instant action",
      desc: "What should I prioritise today?",
      prompt: "Look at my projects and tasks — what should I prioritise today?",
    },
  ],
  [
    {
      title: "Catch me up",
      desc: "Summarize what happened in the team today.",
      prompt: "Summarize today's team activity — Slack, tasks, and clock.",
    },
    {
      title: "Draft something",
      desc: "A status update, a client reply, a project note.",
      prompt: "Help me draft a message — I'll tell you who it's for.",
    },
    {
      title: "Check a schedule",
      desc: "Deadlines, overlaps, and who is free.",
      prompt: "Which projects have deadlines in the next two weeks, and who's on them?",
    },
  ],
];

function timeGreeting(name: string): string {
  const hour = new Date().getHours();
  const part = hour < 11 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return `${part}, ${name}.`;
}

export default function Home() {
  const router = useRouter();
  const { data: session } = useSession();
  const createChat = useHermesStore((s) => s.createChat);

  const [starterSet, setStarterSet] = useState(0);
  // Picked after mount so the server-rendered HTML stays deterministic.
  const [greeting, setGreeting] = useState("");
  useEffect(() => {
    const first = session?.user?.name?.split(" ")[0] || "Pixels";
    setGreeting(timeGreeting(first));
  }, [session?.user?.name]);

  const start = (text: string, attachments: Attachment[] = []) => {
    const id = createChat(text, undefined, attachments);
    router.push(`/chat/${id}`);
  };

  return (
    <div className="flex h-full flex-col px-8 pt-5 pb-6">
      {/* Hero centers in whatever space the window gives it… */}
      <div className="flex-1 flex flex-col justify-center w-full max-w-2xl mx-auto min-h-0">
        <h1 className="text-[38px] font-semibold tracking-tight text-center mb-2 min-h-[1.2em] transition-opacity duration-300">
          {greeting || " "}
        </h1>
        <p className="text-center text-ink-soft mb-10">
          Your team&apos;s knowledge. A fresh perspective. All in one place.
        </p>

        <div className="flex items-center justify-between mb-2.5">
          <p className="text-[11.5px] font-semibold text-ink">A good place to start</p>
          <button
            onClick={() => setStarterSet((s) => (s + 1) % STARTER_SETS.length)}
            className="flex items-center gap-0.5 text-[11.5px] font-medium text-accent hover:underline"
          >
            Explore prompts
            <ChevronRight size={11} />
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {STARTER_SETS[starterSet].map((s) => (
            <button
              key={s.title}
              onClick={() => start(s.prompt)}
              className="text-left rounded-2xl bg-parchment-dark/80 px-3.5 py-3.5 hover:bg-parchment-dark transition-colors"
            >
              <p className="text-[13px] font-semibold mb-1.5">{s.title}</p>
              <p className="text-[12px] text-ink-soft leading-snug">{s.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* …while the composer stays anchored to the bottom of the window. */}
      <div className="w-full max-w-2xl mx-auto">
        <Composer
          onSend={start}
          autoFocus
          placeholder="Ask a question, find a document, or explore an idea…"
        />
      </div>
    </div>
  );
}
