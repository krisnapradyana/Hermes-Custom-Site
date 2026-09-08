"use client";

import Link from "next/link";
import { Wrench, FileText, ImageIcon, Clapperboard, ArrowRight } from "lucide-react";

/**
 * Tools hub — the studio's growing box of agentic and non-agentic utilities.
 * Each tool gets a card; unreleased ones sit greyed with a "soon" capsule so
 * the team knows what is coming.
 */

const SOON = (
  <span className="rounded-full border border-amber-500/50 bg-amber-500/10 px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
    soon
  </span>
);

export default function ToolsPage() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-xl bg-accent-soft flex items-center justify-center">
          <Wrench size={17} className="text-accent" />
        </div>
        <h1 className="font-serif-display text-3xl">Tools</h1>
      </div>
      <p className="text-sm text-ink-soft mb-8">
        Studio utilities — generators and helpers that turn repetitive work into a button.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          prefetch={false}
          href="/tools/brief"
          className="group rounded-xl border border-line bg-card p-4 hover:border-accent/60 transition-colors"
        >
          <div className="flex items-center gap-2.5 mb-1.5">
            <div className="w-8 h-8 rounded-lg bg-accent-soft flex items-center justify-center">
              <FileText size={15} className="text-accent" />
            </div>
            <p className="font-medium text-[15px] flex-1">Brief generator</p>
            <ArrowRight size={14} className="text-ink-faint group-hover:text-accent transition-colors" />
          </div>
          <p className="text-[12.5px] text-ink-soft">
            Feed it a client SOW or RFQ — get the SuperPixel internal production brief:
            deliverables with load estimates, team plan, timeline read, and the blockers to chase.
          </p>
        </Link>

        <div className="rounded-xl border border-line bg-card p-4 opacity-60">
          <div className="flex items-center gap-2.5 mb-1.5">
            <div className="w-8 h-8 rounded-lg bg-parchment-dark flex items-center justify-center">
              <ImageIcon size={15} className="text-ink-faint" />
            </div>
            <p className="font-medium text-[15px] flex-1">Nano Banana</p>
            {SOON}
          </div>
          <p className="text-[12.5px] text-ink-soft">Image generation and editing for boards and styleframes.</p>
        </div>

        <div className="rounded-xl border border-line bg-card p-4 opacity-60">
          <div className="flex items-center gap-2.5 mb-1.5">
            <div className="w-8 h-8 rounded-lg bg-parchment-dark flex items-center justify-center">
              <Clapperboard size={15} className="text-ink-faint" />
            </div>
            <p className="font-medium text-[15px] flex-1">Seedance</p>
            {SOON}
          </div>
          <p className="text-[12.5px] text-ink-soft">Video generation for animatics and motion tests.</p>
        </div>
      </div>
    </div>
  );
}
