"use client";

import { useRouter } from "next/navigation";
import { useHermesStore } from "@/lib/store";
import { Composer } from "@/components/Composer";

const suggestions = [
  "Summarize today's Slack activity",
  "What can you help me with?",
  "Draft a status update for the team",
  "Review my latest deployment logs",
];

export default function Home() {
  const router = useRouter();
  const createChat = useHermesStore((s) => s.createChat);

  const start = (text: string) => {
    const id = createChat(text);
    router.push(`/chat/${id}`);
  };

  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="w-full max-w-2xl -mt-24">
        <h1 className="font-serif-display text-4xl text-center mb-2">
          What can Hermes do for you?
        </h1>
        <p className="text-center text-ink-soft mb-8">
          Same agent that answers in Slack — now with a proper desk.
        </p>

        <Composer onSend={start} autoFocus placeholder="Ask Hermes anything…" />

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => start(s)}
              className="rounded-full border border-line bg-card px-3.5 py-1.5 text-[13px] text-ink-soft hover:border-ink-faint hover:text-ink transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
