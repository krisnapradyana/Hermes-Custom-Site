"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useHermesStore } from "@/lib/store";
import { Composer } from "@/components/Composer";
import { Attachment } from "@/lib/types";

/**
 * Chat home — UI-refresh prototype, modeled on the Figma "Default interface"
 * frame: time-of-day greeting with the member's first name, one-line promise,
 * composer, and three starter cards instead of suggestion chips.
 */

const STARTERS: { title: string; desc: string; prompt: string }[] = [
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
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="w-full max-w-2xl -mt-20">
        <h1 className="text-4xl font-semibold tracking-tight text-center mb-2.5 min-h-[1.2em] transition-opacity duration-300">
          {greeting || " "}
        </h1>
        <p className="text-center text-ink-soft mb-9">
          Your team&apos;s knowledge. A fresh perspective. All in one place.
        </p>

        <div className="mb-7">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint mb-2">
            A good place to start
          </p>
          <div className="grid gap-2.5 sm:grid-cols-3">
            {STARTERS.map((s) => (
              <button
                key={s.title}
                onClick={() => start(s.prompt)}
                className="text-left rounded-xl border border-line bg-card px-3.5 py-3 hover:border-accent/50 hover:shadow-sm transition-all"
              >
                <p className="text-[13.5px] font-medium mb-1">{s.title}</p>
                <p className="text-[12px] text-ink-soft leading-snug">{s.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <Composer onSend={start} autoFocus placeholder="Ask a question, find a document, or explore an idea…" />
      </div>
    </div>
  );
}
