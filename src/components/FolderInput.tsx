"use client";

import { useEffect, useRef, useState } from "react";
import { FolderCheck, FolderX, Loader2 } from "lucide-react";

type Status = "idle" | "checking" | "ok" | "bad";

/**
 * Path input with live server-side validation (folder must exist on the
 * machine running the app/agent). Reports validity to the parent.
 */
export function FolderInput({
  value,
  onChange,
  onStatus,
  placeholder,
  label,
  optional,
}: {
  value: string;
  onChange: (v: string) => void;
  onStatus?: (ok: boolean) => void;
  placeholder?: string;
  label?: string;
  optional?: boolean;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    clearTimeout(timer.current);
    const trimmed = value.trim();

    if (!trimmed) {
      setStatus("idle");
      setMessage("");
      onStatus?.(!!optional); // empty is fine only when optional
      return;
    }

    setStatus("checking");
    onStatus?.(false);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/fs/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: trimmed }),
        });
        const data = await res.json();
        setStatus(data.ok ? "ok" : "bad");
        setMessage(data.message ?? "");
        onStatus?.(!!data.ok);
      } catch {
        setStatus("bad");
        setMessage("Could not validate the path");
        onStatus?.(false);
      }
    }, 500);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, optional]);

  return (
    <div>
      {label && (
        <p className="text-sm font-medium mb-1.5">
          {label}
          {optional && <span className="text-ink-faint font-normal"> (optional)</span>}
        </p>
      )}
      <div className="relative">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? "E:\\Projects\\my-project"}
          spellCheck={false}
          className="w-full rounded-lg border border-line bg-transparent px-3 py-2 pr-9 text-sm font-mono outline-none focus:border-ink-faint"
        />
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
          {status === "checking" && <Loader2 size={14} className="animate-spin text-ink-faint" />}
          {status === "ok" && <FolderCheck size={14} className="text-green-600" />}
          {status === "bad" && <FolderX size={14} className="text-red-500" />}
        </span>
      </div>
      {status === "bad" && <p className="mt-1 text-[11px] text-red-500">{message}</p>}
      {status === "ok" && <p className="mt-1 text-[11px] text-green-600">{message}</p>}
    </div>
  );
}
