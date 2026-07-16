"use client";

import { useRef, useState } from "react";
import { ArrowUp } from "lucide-react";

export function Composer({
  onSend,
  disabled,
  placeholder = "Message Hermes…",
  autoFocus,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue("");
    if (ref.current) ref.current.style.height = "auto";
  };

  return (
    <div className="rounded-2xl border border-line bg-card shadow-sm focus-within:border-ink-faint transition-colors">
      <textarea
        ref={ref}
        value={value}
        autoFocus={autoFocus}
        rows={1}
        placeholder={placeholder}
        className="w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] outline-none placeholder:text-ink-faint max-h-48"
        onChange={(e) => {
          setValue(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = `${Math.min(e.target.scrollHeight, 192)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="flex items-center justify-between px-3 pb-2.5">
        <span className="text-[11px] text-ink-faint pl-1">
          Hermes · connected to Slack workspace
        </span>
        <button
          onClick={submit}
          disabled={!value.trim() || disabled}
          className="p-1.5 rounded-lg bg-accent text-white disabled:opacity-30 hover:bg-accent-hover transition-colors"
          title="Send"
        >
          <ArrowUp size={16} />
        </button>
      </div>
    </div>
  );
}
