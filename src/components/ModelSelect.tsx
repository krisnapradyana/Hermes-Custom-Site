"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check, Cpu } from "lucide-react";
import { ModelChoice } from "@/lib/model-choices";
import { fetchModelChoices, getSelectedModel, setSelectedModel } from "@/lib/model-select";

/**
 * Claude-style model picker for the composer. The choice is remembered and
 * applies to every message the user sends until changed.
 *
 * Per Hermes' docs: switching models MID-conversation resets the provider's
 * prompt cache, so the next message re-reads the whole history at full
 * input price. The menu says so — switch early in a chat, not deep into one.
 */
export function ModelSelect() {
  const [choices, setChoices] = useState<ModelChoice[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchModelChoices().then((list) => {
      setChoices(list);
      const saved = getSelectedModel();
      // Fall back to the first configured choice when nothing is saved or
      // the saved id was removed from the allowlist.
      setSelected(saved && list.some((c) => c.id === saved) ? saved : list[0]?.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (choices.length === 0) return null;
  const current = choices.find((c) => c.id === selected) ?? choices[0];
  // Short name for the trigger: "Opus 4.6 · most capable" → "Opus 4.6"
  const shortLabel = current.label.split("·")[0].trim();

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] transition-colors ${
          open ? "bg-parchment-dark text-ink" : "text-ink-faint hover:text-ink hover:bg-parchment-dark"
        }`}
        title="Choose the AI model for your messages"
      >
        <Cpu size={11} className="text-accent" />
        <span className="max-w-[9rem] truncate">{shortLabel}</span>
        <ChevronDown size={11} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1.5 z-50 w-64 rounded-xl border border-line bg-card p-1.5 shadow-lg">
          {choices.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setSelected(c.id);
                setSelectedModel(c.id);
                setOpen(false);
              }}
              className="w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] hover:bg-parchment-dark"
            >
              <span className={c.id === current.id ? "font-medium" : ""}>{c.label}</span>
              {c.id === current.id && <Check size={12} className="text-accent shrink-0" />}
            </button>
          ))}
          <p className="mt-1 px-2.5 pt-1.5 pb-1 border-t border-line text-[10px] text-ink-faint leading-relaxed">
            Applies to your next message. Tip: switching mid-conversation makes the next reply
            slower and pricier (the AI re-reads the whole chat) — best to pick at the start.
          </p>
        </div>
      )}
    </div>
  );
}
