"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animated number: counts from 0 to `value` on mount (and re-runs when the
 * target changes), ease-out over ~600ms. Skips straight to the value when
 * the OS asks for reduced motion. Purely visual — screen readers and
 * reduced-motion users always get the real number.
 */
export function CountUp({
  value,
  pad = 0,
  format,
}: {
  value: number;
  pad?: number;
  /** Custom formatter (e.g. milliseconds → "65h 41m"); wins over pad. */
  format?: (n: number) => string;
}) {
  const [shown, setShown] = useState(0);
  const raf = useRef<number>(0);
  // Animate FROM the last shown value, not from 0 — pages that poll (project
  // man-hours every 30s) must glide to the new number, not re-count.
  const fromRef = useRef(0);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      fromRef.current = value;
      setShown(value);
      return;
    }
    const from = fromRef.current;
    if (from === value) return;
    const start = performance.now();
    const dur = 600;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      const cur = Math.round(from + eased * (value - from));
      setShown(cur);
      fromRef.current = cur;
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value]);

  return <>{format ? format(shown) : String(shown).padStart(pad, "0")}</>;
}
