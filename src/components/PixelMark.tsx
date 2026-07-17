"use client";

/**
 * The SuperPixel mark. `thinking` turns on the "breathe" animation
 * (diagonal pixel pairs swell alternately); static otherwise.
 */
export function PixelMark({ size = 26, thinking = false }: { size?: number; thinking?: boolean }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={thinking ? "pixelmark-thinking" : undefined}
      aria-hidden
    >
      <rect width="64" height="64" rx="14" fill="#2A73E1" />
      <rect className="px pa" x="13" y="13" width="17" height="17" rx="3" fill="#fff" />
      <rect className="px pb" x="34" y="13" width="17" height="17" rx="3" fill="#fff" opacity="0.55" />
      <rect className="px pb" x="13" y="34" width="17" height="17" rx="3" fill="#fff" opacity="0.55" />
      <rect className="px pa" x="34" y="34" width="17" height="17" rx="3" fill="#fff" />
    </svg>
  );
}
