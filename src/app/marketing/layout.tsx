import type { Metadata } from "next";

/**
 * SuperPixel Marketing — its own tab title (and, via ./icon.svg, its own
 * favicon) so it is never mistaken for the Assistant in a row of tabs.
 */
export const metadata: Metadata = {
  title: "SuperPixel Marketing",
  description: "SuperPixel Marketing — publish radar, content pipeline, checker studio and house rules.",
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
