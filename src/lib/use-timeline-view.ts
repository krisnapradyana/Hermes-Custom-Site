"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Blender-style navigation for day-based timelines (Schedule Gantt, project
 * timeline): mouse wheel zooms around the cursor, dragging pans, and a Fit
 * action returns to the full range. Consumers position everything with
 * pct()/spanPct() computed against the current view window; anything
 * outside simply clips (containers need overflow-hidden).
 *
 * Click safety: a drag only counts after 4px of movement, and the click
 * that ends a real drag is swallowed in the capture phase — links and
 * buttons inside the chart keep working normally.
 */

const MIN_SPAN = 7; // days — don't zoom in past a week

export function useTimelineView(fullFrom: number, fullTo: number) {
  const [win, setWin] = useState<{ from: number; to: number } | null>(null); // null = fit
  const from = win?.from ?? fullFrom;
  const to = win?.to ?? fullTo;
  const total = Math.max(1, to - from + 1);

  const clamp = useCallback(
    (f: number, span: number) => {
      const fullSpan = Math.max(1, fullTo - fullFrom + 1);
      const s = Math.max(MIN_SPAN, Math.min(Math.round(span), fullSpan * 2));
      const lo = fullFrom - fullSpan;
      const hi = fullTo + fullSpan;
      let nf = Math.round(f);
      if (nf < lo) nf = lo;
      if (nf + s - 1 > hi) nf = hi - s + 1;
      return { from: nf, to: nf + s - 1 };
    },
    [fullFrom, fullTo]
  );

  /** Zoom by factor, keeping the day under `frac` (0..1 across the canvas) fixed. */
  const zoomAt = useCallback(
    (frac: number, factor: number) => {
      const anchor = from + frac * total;
      const span = total * factor;
      setWin(clamp(anchor - frac * span, span));
    },
    [from, total, clamp]
  );

  const zoom = useCallback((factor: number) => zoomAt(0.5, factor), [zoomAt]);
  const fit = useCallback(() => setWin(null), []);
  const panBy = useCallback(
    (days: number) => setWin((w) => clamp((w?.from ?? fullFrom) + days, total)),
    [clamp, fullFrom, total]
  );

  // ---- canvas bindings ----
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ startX: number; startFrom: number; moved: boolean } | null>(null);
  const [panning, setPanning] = useState(false);

  // Wheel must be a NATIVE non-passive listener — React's synthetic onWheel
  // can't preventDefault, and the page would scroll instead of zooming.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      // Horizontal wheel / shift+wheel = pan; plain scroll = zoom at cursor.
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const d = (e.deltaX || e.deltaY) / rect.width;
        panBy(d * total * 0.6);
        return;
      }
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      zoomAt(frac, e.deltaY > 0 ? 1.18 : 1 / 1.18);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [panBy, zoomAt, total]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      drag.current = { startX: e.clientX, startFrom: from, moved: false };
    },
    [from]
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      const el = canvasRef.current;
      if (!d || !el) return;
      const dx = e.clientX - d.startX;
      if (!d.moved && Math.abs(dx) < 4) return; // click, not a drag (yet)
      if (!d.moved) {
        d.moved = true;
        setPanning(true);
        el.setPointerCapture(e.pointerId);
      }
      const days = (dx / el.getBoundingClientRect().width) * total;
      setWin(clamp(d.startFrom - days, total));
    },
    [clamp, total]
  );
  const endDrag = useCallback((e: React.PointerEvent) => {
    if (drag.current?.moved) canvasRef.current?.releasePointerCapture(e.pointerId);
    setPanning(false);
    // keep drag.current until the click fires so onClickCapture can see it
    setTimeout(() => {
      drag.current = null;
    }, 0);
  }, []);
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (drag.current?.moved) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  const pct = useCallback((day: number) => ((day - from) / total) * 100, [from, total]);
  const spanPct = useCallback(
    (a: number, b: number) => (Math.max(1, b - a + 1) / total) * 100,
    [total]
  );

  return {
    from,
    to,
    total,
    pct,
    spanPct,
    zoom,
    fit,
    isFit: win === null,
    canvasRef,
    canvasProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onClickCapture,
      style: {
        cursor: panning ? "grabbing" : "grab",
        touchAction: "pan-y" as const,
        userSelect: "none" as const,
      },
    },
  };
}

/** The −/+/Fit cluster + hint, same look on every timeline. */
export const TIMELINE_HINT = "scroll to zoom · drag to move";
