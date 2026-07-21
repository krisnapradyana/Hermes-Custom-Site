"use client";

import { PixelMark } from "@/components/PixelMark";

/** SuperPixel pixel mark + "Assistant" wordmark. */
export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2 min-w-0">
      <PixelMark size={size} />
      <span className="font-bold tracking-tight" style={{ fontSize: size * 0.7 }}>
        SuperP<span className="text-accent">ix</span>el
      </span>
      <span className="text-ink-faint font-normal" style={{ fontSize: size * 0.6 }}>
        Assistant
      </span>
    </span>
  );
}
