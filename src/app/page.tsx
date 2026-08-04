"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useHermesStore } from "@/lib/store";
import { Composer } from "@/components/Composer";
import { Attachment } from "@/lib/types";

const suggestions = [
  "Summarize today's Slack activity",
  "What can you help me with?",
  "Draft a status update for the team",
  "Review my latest deployment logs",
];

const GREETINGS = [
  "Hey Pixels, what are we making today?",
  "What can I do for you, Pixels?",
  "Ready when you are, Pixels.",
  "Welcome back, Pixels.",
  "Pixels! What's on deck today?",
  "Let's make something great, Pixels.",
  "At your service, Pixels.",
];

function pickGreeting(): string {
  const hour = new Date().getHours();
  const timed =
    hour < 11
      ? "Good morning, Pixels ☀️"
      : hour < 17
        ? "Good afternoon, Pixels!"
        : "Good evening, Pixels 🌙";
  const pool = [...GREETINGS, timed, timed]; // time-aware one gets a double chance
  return pool[Math.floor(Math.random() * pool.length)];
}

export default function Home() {
  const router = useRouter();
  const createChat = useHermesStore((s) => s.createChat);
  // Picked after mount so the server-rendered HTML stays deterministic.
  const [greeting, setGreeting] = useState("");
  useEffect(() => setGreeting(pickGreeting()), []);

  const start = (text: string, attachments: Attachment[] = []) => {
    const id = createChat(text, undefined, attachments);
    router.push(`/chat/${id}`);
  };

  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="w-full max-w-2xl -mt-24">
        <h1 className="font-serif-display text-4xl text-center mb-2 min-h-[1.2em] transition-opacity duration-300">
          {greeting || " "}
        </h1>
        <p className="text-center text-ink-soft mb-8">Ask anything — ideas, files, schedules.</p>

        <Composer onSend={start} autoFocus placeholder="Ask anything…" />

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
