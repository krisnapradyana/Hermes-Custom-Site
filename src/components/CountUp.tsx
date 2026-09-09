"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animated number: counts from 0 to `value` on mount (and re-runs when the
 * target changes), ease-out over ~600ms. Skips straight to the value when
 * the OS asks for reduced motion. Purely visual — screen readers and
 * reduced-motion users always get the real number.
 */
export function CountUp({ value, pad = 0 }: { value: number; pad?: number }) {
  const [shown, setShown] = useState(0);
  const raf = useRef<number>(0);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const dur = 600;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setShown(Math.round(eased * value));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value]);

  return <>{String(shown).padStart(pad, "0")}</>;
}
