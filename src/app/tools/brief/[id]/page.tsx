"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Printer, TriangleAlert, FolderKanban } from "lucide-react";
import { api } from "@/lib/api";
import { renderMarkdown } from "@/lib/markdown";
import { useHermesStore } from "@/lib/store";

/** One generated brief: polls while Hermes writes, then renders + prints. */

interface Brief {
  id: string;
  status: "generating" | "ready" | "error";
  error?: string;
  title: string;
  sourceFile: string;
  projectId?: string;
  contact?: string;
  markdown?: string;
  createdBy: string;
  createdAt: string;
}

export default function BriefViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const projects = useHermesStore((s) => s.projects);
  const loadProjects = useHermesStore((s) => s.loadProjects);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await api.get<{ brief: Brief }>(`/api/tools/brief/${encodeURIComponent(id)}`);
    if (res.ok) {
      setBrief(res.data.brief);
      setError("");
    } else setError(res.error);
  }, [id]);

  useEffect(() => {
    load();
    loadProjects();
  }, [load, loadProjects]);

  // Poll only while generating.
  useEffect(() => {
    if (brief?.status !== "generating") return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [brief?.status, load]);

  const attach = async (projectId: string) => {
    await api.patch(`/api/tools/brief/${encodeURIComponent(id)}`, {
      projectId: projectId || null,
    });
    load();
  };

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      {/* Toolbar — hidden when printing. */}
      <div className="flex flex-wrap items-center gap-2 mb-6 print:hidden">
        <Link
          prefetch={false}
          href="/tools/brief"
          className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink"
        >
          <ArrowLeft size={14} />
          Briefs
        </Link>
        <span className="flex-1" />
        {brief?.status === "ready" && (
          <>
            <label className="flex items-center gap-1.5 text-[12px] text-ink-soft">
              <FolderKanban size={13} className="text-ink-faint" />
              <select
                value={brief.projectId ?? ""}
                onChange={(e) => attach(e.target.value)}
                className="rounded-lg border border-line bg-card px-2 py-1.5 text-[12.5px] outline-none"
              >
                <option value="">Not attached to a project</option>
                {projects
                  .filter((p) => !p.archived)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] text-white hover:bg-accent-hover"
              title="Print / save as PDF"
            >
              <Printer size={13} />
              Print / PDF
            </button>
          </>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-[13px] text-red-500">
          {error}
        </p>
      )}
      {!brief && !error && <p className="text-sm text-ink-faint py-10 text-center">Loading…</p>}

      {brief?.status === "generating" && (
        <div className="rounded-xl border border-line bg-card p-10 text-center">
          <Loader2 size={22} className="animate-spin text-accent mx-auto mb-3" />
          <p className="text-sm font-medium mb-1">Writing the brief…</p>
          <p className="text-[12.5px] text-ink-faint max-w-md mx-auto">
            The agent is reading &ldquo;{brief.sourceFile}&rdquo; and rewriting it as the internal
            production brief. This usually takes a minute or two — you can leave this page and come
            back.
          </p>
        </div>
      )}

      {brief?.status === "error" && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-6">
          <p className="flex items-center gap-2 text-sm font-medium mb-1">
            <TriangleAlert size={15} className="text-red-500" />
            Generation failed
          </p>
          <p className="text-[13px] text-ink-soft mb-3">{brief.error}</p>
          <p className="text-[12.5px] text-ink-faint">
            Delete this entry on the briefs page and try again — if it keeps failing, the agent
            server may be busy or down.
          </p>
        </div>
      )}

      {brief?.status === "ready" && brief.markdown && (
        <article
          className="md-body brief-doc rounded-xl border border-line bg-card px-8 py-7 print:border-0 print:px-0 print:py-0"
          // Safe: renderMarkdown escapes all input before transforming.
          dangerouslySetInnerHTML={{ __html: renderMarkdown(brief.markdown) }}
        />
      )}

      {brief?.status === "ready" && (
        <p className="mt-3 text-[11px] text-ink-faint print:hidden">
          Generated by the agent from &ldquo;{brief.sourceFile}&rdquo; · requested by{" "}
          {brief.createdBy} · always sanity-check numbers and dates against the client document
          before quoting.
        </p>
      )}
    </div>
  );
}
