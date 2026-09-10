"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Drag-to-resize for side panels. Width persists per `key` in localStorage.
 * `fromRight` = panel sits on the right edge (dragging left widens it).
 */
export function useResizableWidth(
  key: string,
  initial: number,
  min: number,
  max: number,
  fromRight = false
) {
  const [width, setWidth] = useState(initial);
  const widthRef = useRef(initial);

  useEffect(() => {
    const saved = parseInt(localStorage.getItem(key) ?? "", 10);
    if (!Number.isNaN(saved)) {
      const w = Math.min(max, Math.max(min, saved));
      setWidth(w);
      widthRef.current = w;
    }
  }, [key, min, max]);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widthRef.current;

    const move = (ev: PointerEvent) => {
      const d = ev.clientX - startX;
      const w = Math.min(max, Math.max(min, fromRight ? startW - d : startW + d));
      widthRef.current = w;
      setWidth(w);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.body.classList.remove("resizing");
      localStorage.setItem(key, String(widthRef.current));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    // Touch: the browser may still cancel the stream (system gestures) —
    // without this, the body stayed stuck in "resizing" state on tablets.
    window.addEventListener("pointercancel", up);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    // Iframes (HTML/PDF previews) would swallow pointer events mid-drag.
    document.body.classList.add("resizing");
  };

  return { width, startResize };
}

export function ResizeHandle({
  onPointerDown,
  title = "Drag to resize",
}: {
  onPointerDown: (e: React.PointerEvent) => void;
  title?: string;
}) {
  return (
    <div
      onPointerDown={onPointerDown}
      title={title}
      // touch-action:none is THE fix for touch dragging: without it the
      // browser claims the gesture for scrolling ~10px in and cancels the
      // pointer stream ("drags a few frames then stops", field report).
      style={{ touchAction: "none" }}
      className="resize-handle w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-accent/40 active:bg-accent/60 transition-colors"
    />
  );
}
