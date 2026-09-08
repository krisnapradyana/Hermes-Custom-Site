"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Upload, ArrowLeft, Trash2, Loader2, TriangleAlert, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useHermesStore } from "@/lib/store";

/** Brief generator — upload a client document, get the internal brief. */

interface BriefMeta {
  id: string;
  status: "generating" | "ready" | "error";
  error?: string;
  title: string;
  sourceFile: string;
  projectId?: string;
  createdBy: string;
  createdAt: string;
}

export default function BriefToolPage() {
  const router = useRouter();
  const projects = useHermesStore((s) => s.projects);
  const loadProjects = useHermesStore((s) => s.loadProjects);

  const [briefs, setBriefs] = useState<BriefMeta[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [projectId, setProjectId] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await api.get<{ briefs: BriefMeta[] }>("/api/tools/brief");
    if (res.ok) setBriefs(res.data.briefs);
  }, []);

  useEffect(() => {
    load();
    loadProjects();
    // Poll while anything is still generating.
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 5000);
    return () => clearInterval(t);
  }, [load, loadProjects]);

  const generate = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    const form = new FormData();
    form.append("file", file);
    if (contact.trim()) form.append("contact", contact.trim());
    if (notes.trim()) form.append("notes", notes.trim());
    if (projectId) form.append("projectId", projectId);
    try {
      const res = await fetch("/api/tools/brief", { method: "POST", body: form });
      const j = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !j.id) {
        setError(j.error ?? `Upload failed (${res.status})`);
        setBusy(false);
        return;
      }
      router.push(`/tools/brief/${j.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await api.del(`/api/tools/brief/${encodeURIComponent(id)}`);
    load();
  };

  const pickFile = (f: File | undefined | null) => {
    if (!f) return;
    if (!/\.(pdf|docx|txt|md)$/i.test(f.name)) {
      setError("PDF, DOCX, TXT or MD only");
      return;
    }
    setError("");
    setFile(f);
  };

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <Link
        prefetch={false}
        href="/tools"
        className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink mb-5"
      >
        <ArrowLeft size={14} />
        Tools
      </Link>

      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-xl bg-accent-soft flex items-center justify-center">
          <FileText size={17} className="text-accent" />
        </div>
        <h1 className="font-serif-display text-3xl">Brief generator</h1>
      </div>
      <p className="text-sm text-ink-soft mb-7">
        Upload the client&apos;s SOW / RFQ. The agent rewrites it as the SuperPixel internal brief —
        what the job actually is, every deliverable with a load estimate, who we need, and the
        blockers to chase before work can start.
      </p>

      {/* Form */}
      <div className="rounded-xl border border-line bg-card p-4 mb-8 space-y-3">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            pickFile(e.dataTransfer.files?.[0]);
          }}
          onClick={() => fileInput.current?.click()}
          className={`flex items-center justify-center gap-2.5 rounded-lg border border-dashed px-4 py-6 cursor-pointer transition-colors ${
            dragOver ? "border-accent bg-accent-soft/30" : "border-line hover:border-ink-faint"
          }`}
        >
          <Upload size={16} className="text-ink-faint" />
          <span className="text-[13.5px] text-ink-soft">
            {file ? (
              <span className="font-medium text-ink">{file.name}</span>
            ) : (
              "Drop the client document here, or click to choose (PDF · DOCX · TXT)"
            )}
          </span>
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          <input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="Internal contact (e.g. Kelvin) — optional"
            className="rounded-lg border border-line bg-transparent px-3 py-2 text-[13px] outline-none focus:border-ink-faint placeholder:text-ink-faint"
          />
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="rounded-lg border border-line bg-card px-2.5 py-2 text-[13px] text-ink-soft outline-none"
          >
            <option value="">Attach to project later</option>
            {projects
              .filter((p) => !p.archived)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Extra context the document doesn't say — reference links, verbal agreements, what worries you… (optional)"
          className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-[13px] outline-none focus:border-ink-faint placeholder:text-ink-faint resize-y"
        />

        {error && <p className="text-[13px] text-red-500">{error}</p>}

        <button
          onClick={generate}
          disabled={!file || busy}
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-40"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
          {busy ? "Reading document…" : "Generate brief"}
        </button>
      </div>

      {/* History */}
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint mb-2">
        Generated briefs
      </p>
      {briefs === null && <p className="text-[13px] text-ink-faint py-2">Loading…</p>}
      {briefs?.length === 0 && (
        <p className="text-[13px] text-ink-faint py-2">Nothing yet — the first one lands here.</p>
      )}
      <div className="space-y-1.5">
        {briefs?.map((b) => (
          <div
            key={b.id}
            className="flex items-center gap-3 rounded-xl border border-line bg-card px-3.5 py-2.5"
          >
            {b.status === "generating" ? (
              <Loader2 size={14} className="animate-spin text-accent shrink-0" />
            ) : b.status === "error" ? (
              <TriangleAlert size={14} className="text-red-500 shrink-0" />
            ) : (
              <CheckCircle2 size={14} className="text-green-500 shrink-0" />
            )}
            <Link
              prefetch={false}
              href={`/tools/brief/${encodeURIComponent(b.id)}`}
              className="flex-1 min-w-0 hover:text-accent transition-colors"
            >
              <p className="text-[13.5px] font-medium truncate">{b.title}</p>
              <p className="text-[11.5px] text-ink-faint truncate">
                {b.sourceFile} · {b.createdBy} · {timeAgo(b.createdAt)}
                {b.projectId &&
                  ` · ${projects.find((p) => p.id === b.projectId)?.name ?? "attached project"}`}
                {b.status === "error" && ` · failed: ${b.error}`}
              </p>
            </Link>
            <button
              onClick={() => remove(b.id)}
              className="p-1.5 text-ink-faint hover:text-red-500 shrink-0"
              title="Delete brief"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
