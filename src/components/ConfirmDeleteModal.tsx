"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";

/**
 * Destructive-action gate: the user must type DELETE to enable the button.
 */
export function ConfirmDeleteModal({
  title,
  description,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const armed = text === "DELETE";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-line bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 mb-2">
          <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
            <TriangleAlert size={16} className="text-red-500" />
          </div>
          <h2 className="text-[15px] font-semibold">{title}</h2>
        </div>

        <p className="text-sm text-ink-soft mb-4">{description}</p>

        <p className="text-[12px] text-ink-faint mb-1.5">
          Type <span className="font-mono font-semibold text-red-500">DELETE</span> to confirm:
        </p>
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && armed) onConfirm();
            if (e.key === "Escape") onCancel();
          }}
          placeholder="DELETE"
          spellCheck={false}
          className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm font-mono outline-none focus:border-red-400 mb-4"
        />

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg px-3.5 py-2 text-sm text-ink-soft hover:bg-parchment-dark"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!armed}
            className="rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Delete permanently
          </button>
        </div>
      </div>
    </div>
  );
}
