"use client";

import { useState } from "react";

/**
 * SuperPixel logo + "Assistant" wordmark.
 * Save the logo file to /public/superpixel.png — until then a text
 * fallback renders. `dark:invert` keeps the black logo visible in dark mode.
 */
export function BrandMark({ size = 24 }: { size?: number }) {
  const [broken, setBroken] = useState(false);

  return (
    <span className="flex items-center gap-2 min-w-0">
      {broken ? (
        <span className="font-bold tracking-tight" style={{ fontSize: size * 0.75 }}>
          SuperP<span className="text-accent">ix</span>el
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/superpixel.png"
          alt="SuperPixel"
          style={{ height: size }}
          className="dark:invert"
          onError={() => setBroken(true)}
        />
      )}
      <span className="text-ink-faint font-normal" style={{ fontSize: size * 0.62 }}>
        Assistant
      </span>
    </span>
  );
}
