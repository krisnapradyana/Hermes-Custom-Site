"use client";

import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";

type Theme = "light" | "dark" | "system";
const KEY = "hermes-theme";

function apply(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    setTheme((localStorage.getItem(KEY) as Theme) ?? "system");
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (((localStorage.getItem(KEY) as Theme) ?? "system") === "system") apply("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const cycle = () => {
    const next: Theme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    setTheme(next);
    localStorage.setItem(KEY, next);
    apply(next);
  };

  const icon =
    theme === "light" ? <Sun size={15} /> : theme === "dark" ? <Moon size={15} /> : <Monitor size={15} />;

  return (
    <button
      onClick={cycle}
      className="p-1.5 rounded-lg hover:bg-parchment-dark text-ink-faint hover:text-ink transition-colors"
      title={`Theme: ${theme} (click to change)`}
    >
      {icon}
    </button>
  );
}
