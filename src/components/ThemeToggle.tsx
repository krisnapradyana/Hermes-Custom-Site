"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

const KEY = "hermes-theme";

/** Sun/moon pair toggle (sidebar footer). */
export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") setTheme(saved);
    else setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }, []);

  const choose = (t: "light" | "dark") => {
    setTheme(t);
    localStorage.setItem(KEY, t);
    document.documentElement.classList.toggle("dark", t === "dark");
  };

  return (
    <div className="flex items-center rounded-full border border-line p-0.5">
      <button
        onClick={() => choose("light")}
        className={`p-1.5 rounded-full transition-colors ${
          theme === "light" ? "bg-accent-soft text-accent" : "text-ink-faint hover:text-ink"
        }`}
        title="Light mode"
      >
        <Sun size={13} />
      </button>
      <button
        onClick={() => choose("dark")}
        className={`p-1.5 rounded-full transition-colors ${
          theme === "dark" ? "bg-accent-soft text-accent" : "text-ink-faint hover:text-ink"
        }`}
        title="Dark mode"
      >
        <Moon size={13} />
      </button>
    </div>
  );
}
