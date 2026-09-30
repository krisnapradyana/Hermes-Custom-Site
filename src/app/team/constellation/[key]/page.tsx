"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, MessageSquare, ExternalLink, Lightbulb } from "lucide-react";
import { api } from "@/lib/api";

/**
 * Team constellation — pick a member and see their working universe as a
 * tilted 3D-ish orbital graph (FF7R weapon-core homage): projects orbit the
 * person (node size = hours together, ring = health), frequent collaborators
 * ride the outer orbit, everything drifts slowly over a milky-way field.
 *
 * Click a project → sidebar becomes the project dossier (vital signs, team,
 * post-mortem). Click a person → the constellation re-centers on them.
 * Alpha 1 scope; the 90-day time lens is a planned follow-up.
 */

const STANDBY_ID = "standby";
const GENERAL_ID = "general";

interface Pulse {
  userKey: string;
  name: string;
  active: { projectId: string; inAt: string; breakAt?: string } | null;
  todayMs: number;
  weekMs: number;
  weekByProject: { projectId: string; ms: number }[];
  totalByProject?: { projectId: string; ms: number }[];
  tasks: { projectId: string; title: string; status: string; dueDate?: string }[];
}
interface ProjectMeta {
  id: string;
  name: string;
  description?: string;
  color: string;
  startDate?: string;
  deadline?: string;
  doneAt?: string | null;
  tags?: string[];
}
interface DirMember {
  name: string;
  type: string;
  primaryRole: string;
  capabilities: string[];
  slackId?: string;
}
interface Profile {
  role?: string;
  avatar?: string;
}

const fmtH = (ms: number): string => {
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  if (h === 0) return `${m}m`;
  return h >= 100 ? `${h}h` : `${h}h ${m}m`;
};
const toDate = (iso: string) => new Date(`${iso}T00:00:00`);

export default function ConstellationPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const [focusKey, setFocusKey] = useState(decodeURIComponent(key));

  const [members, setMembers] = useState<Pulse[]>([]);
  const [projectInfo, setProjectInfo] = useState<Record<string, { name: string; color: string }>>({});
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [directory, setDirectory] = useState<DirMember[]>([]);

  useEffect(() => {
    api.get<{ members: Pulse[]; projects: Record<string, { name: string; color: string }> }>("/api/team").then((r) => {
      if (r.ok) {
        setMembers(r.data.members);
        setProjectInfo(r.data.projects);
      }
    });
    api.get<{ projects: ProjectMeta[] }>("/api/projects").then((r) => r.ok && setProjects(r.data.projects));
    api.get<{ profiles: Record<string, Profile> }>("/api/team/profiles").then((r) => r.ok && setProfiles(r.data.profiles));
    api.get<{ members: DirMember[] }>("/api/directory/members").then((r) => r.ok && setDirectory(r.data.members)).catch(() => {});
  }, []);

  const focus = members.find((m) => m.userKey === focusKey);

  // ---- graph model ---------------------------------------------------------
  const graph = useMemo(() => {
    if (!focus) return null;
    const real = (focus.totalByProject ?? []).filter(
      (w) => w.ms > 0 && w.projectId !== STANDBY_ID && w.projectId !== GENERAL_ID
    );
    const totalAll = real.reduce((a, w) => a + w.ms, 0);
    const projs = [...real].sort((a, b) => b.ms - a.ms).slice(0, 8);

    // Collaborators: others sharing those projects, ranked by shared count + hours.
    const projIds = new Set(projs.map((p) => p.projectId));
    const collabs = members
      .filter((m) => m.userKey !== focus.userKey)
      .map((m) => {
        const shared = (m.totalByProject ?? [])
          .filter((w) => projIds.has(w.projectId) && w.ms > 0)
          .sort((a, b) => b.ms - a.ms);
        return {
          m,
          shared: shared.map((s) => s.projectId),
          score: shared.length * 1000 + shared.reduce((a, s) => a + Math.min(s.ms, 40 * 3600_000) / 3600_000, 0),
        };
      })
      .filter((c) => c.shared.length > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    const projAngle = new Map<string, number>();
    projs.forEach((p, i) => projAngle.set(p.projectId, (i / projs.length) * Math.PI * 2));

    // Per-project contributor count (bus factor) across the whole team.
    const contributors = (pid: string) =>
      members.filter((m) => (m.totalByProject ?? []).some((w) => w.projectId === pid && w.ms > 0));

    return {
      projs: projs.map((p) => ({
        id: p.projectId,
        ms: p.ms,
        share: totalAll > 0 ? p.ms / totalAll : 0,
        angle: projAngle.get(p.projectId)!,
        contributors: contributors(p.projectId),
      })),
      // Moons around their planet (field feedback): each collaborator sits on
      // the outer orbit NEXT TO their strongest shared project, and siblings
      // of the same project fan out with CONSTANT spacing, centered on it.
      collabs: (() => {
        const byProject = new Map<string, typeof collabs>();
        for (const c of collabs) {
          const pid = c.shared[0];
          byProject.set(pid, [...(byProject.get(pid) ?? []), c]);
        }
        const SPACING = 0.42; // rad between sibling moons
        const out: { member: Pulse; sharedCount: number; topProjectId: string; angle: number }[] = [];
        for (const [pid, group] of byProject) {
          const base = projAngle.get(pid) ?? 0;
          group.forEach((c, k) => {
            out.push({
              member: c.m,
              sharedCount: c.shared.length,
              topProjectId: pid,
              angle: base + (k - (group.length - 1) / 2) * SPACING,
            });
          });
        }
        return out;
      })(),
      totalAll,
    };
  }, [focus, members]);

  // ---- selection -----------------------------------------------------------
  const [selected, setSelected] = useState<{ type: "project"; id: string } | null>(null);
  useEffect(() => setSelected(null), [focusKey]);

  // Project dossier extras, fetched on selection.
  const [projTasks, setProjTasks] = useState<{ status: string; kind?: string; dueDate?: string; archivedAt?: string }[] | null>(null);
  const [hasWisdom, setHasWisdom] = useState(false);
  useEffect(() => {
    setProjTasks(null);
    setHasWisdom(false);
    if (!selected) return;
    api
      .get<{ tasks: { status: string; kind?: string; dueDate?: string; archivedAt?: string }[] }>(
        `/api/projects/${encodeURIComponent(selected.id)}/tasks`
      )
      .then((r) => r.ok && setProjTasks(r.data.tasks));
    api
      .get<{ postmortem: { distilled?: unknown } }>(`/api/projects/${encodeURIComponent(selected.id)}/postmortem`)
      .then((r) => r.ok && setHasWisdom(!!r.data.postmortem.distilled));
  }, [selected]);

  // ---- orbit drift ---------------------------------------------------------
  const [phase, setPhase] = useState(0);
  const phaseRef = useRef(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      phaseRef.current += (t - last) * 0.000045; // full orbit ≈ 2.3 min
      last = t;
      setPhase(phaseRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Milky way — generated once.
  const stars = useMemo(
    () =>
      Array.from({ length: 150 }, (_, i) => ({
        x: Math.random() * 100,
        y: Math.random() * 100,
        r: Math.random() < 0.08 ? 1.1 + Math.random() * 0.5 : 0.25 + Math.random() * 0.5,
        o: 0.15 + Math.random() * 0.5,
        tint: Math.random() < 0.75 ? "#cdd6e8" : Math.random() < 0.6 ? "#9db8f0" : "#e8c9d8",
        cls: `star-drift-${(i % 3) + 1}`,
      })),
    []
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Position on the tilted ellipse + depth styling.
  const CX = 310, CY = 255;
  const pos = (angle: number, rx: number, ry: number) => {
    const a = angle + phase;
    const x = CX + rx * Math.cos(a);
    const y = CY + ry * Math.sin(a);
    const depth = (Math.sin(a) + 1) / 2; // 0 = far, 1 = near
    return { x, y, depth, scale: 0.7 + 0.45 * depth, opacity: 0.4 + 0.6 * depth };
  };

  const selectedProject = selected ? projects.find((p) => p.id === selected.id) : null;
  const dirRec = directory.find((d) => d.slackId === focusKey);
  const statusLine = !focus?.active
    ? { text: "Off — clocked out", color: "text-ink-faint" }
    : focus.active.breakAt
      ? { text: "On a break", color: "text-amber-500" }
      : focus.active.projectId === GENERAL_ID
        ? { text: "General duty", color: "text-teal-500" }
        : focus.active.projectId === STANDBY_ID
          ? { text: "Standby", color: "text-violet-500" }
          : { text: `Working · ${projectInfo[focus.active.projectId]?.name ?? "a project"}`, color: "text-green-500" };

  return (
    <div className="flex h-full bg-[#07080d] text-[#e8eaef]">
      {/* ---- cosmos ---- */}
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(700px 340px at 30% 60%, rgba(76,138,245,0.10), transparent 65%)," +
              "radial-gradient(500px 300px at 75% 25%, rgba(139,92,246,0.12), transparent 65%)," +
              "linear-gradient(115deg, transparent 30%, rgba(200,215,255,0.06) 50%, transparent 70%)",
          }}
          aria-hidden
        />
        <div className="absolute left-4 top-3 z-10 flex items-center gap-3 text-[12px] text-[#6e7684]">
          <Link prefetch={false} href="/team" className="inline-flex items-center gap-1 hover:text-[#a6adba]">
            <ArrowLeft size={13} /> Team
          </Link>
          <span>
            Constellation · <span className="text-[#a6adba]">{focus?.name ?? "…"}</span>
          </span>
        </div>

        {!focus && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-[#6e7684]">
            {members.length === 0 ? "Charting the cosmos…" : "No clock history for this member yet."}
          </p>
        )}

        {focus && graph && (
          <svg viewBox="0 0 620 500" className="h-full w-full" role="img">
            <title>Constellation for {focus.name}</title>
            {stars.map((s, i) => (
              <circle key={i} cx={`${s.x}%`} cy={`${s.y}%`} r={s.r} fill={s.tint} opacity={s.o} className={s.cls} />
            ))}
            <ellipse cx={CX} cy={CY} rx={185} ry={64} fill="none" stroke="rgba(76,138,245,0.18)" strokeWidth="1" />
            <ellipse cx={CX} cy={CY} rx={278} ry={110} fill="none" stroke="rgba(139,92,246,0.12)" strokeWidth="1" strokeDasharray="2 6" />

            {/* edges first, then nodes sorted far→near so depth stacks right */}
            {graph.projs.map((p) => {
              const q = pos(p.angle, 185, 64);
              const color = projectInfo[p.id]?.color ?? "#8a93a3";
              return (
                <line
                  key={`e-${p.id}`}
                  x1={CX}
                  y1={CY}
                  x2={q.x}
                  y2={q.y}
                  stroke={color}
                  strokeOpacity={0.16 + 0.3 * q.depth}
                  strokeWidth={1 + 2.2 * p.share * q.scale}
                />
              );
            })}
            {graph.collabs.map((c) => {
              const q = pos(c.angle, 278, 110);
              // Mock behavior: the person attaches to their strongest SHARED
              // PROJECT, not straight to the core.
              const anchor = c.topProjectId ? pos(graph.projs.find((p) => p.id === c.topProjectId)!.angle, 185, 64) : { x: CX, y: CY };
              return (
                <line
                  key={`ce-${c.member.userKey}`}
                  x1={anchor.x}
                  y1={anchor.y}
                  x2={q.x}
                  y2={q.y}
                  stroke="rgba(255,255,255,0.13)"
                  strokeWidth={0.9}
                />
              );
            })}

            {[...graph.projs.map((p) => ({ kind: "proj" as const, p, q: pos(p.angle, 185, 64) })),
              ...graph.collabs.map((c) => ({ kind: "collab" as const, c, q: pos(c.angle, 278, 110) })),
              { kind: "core" as const, q: { x: CX, y: CY, depth: 0.5, scale: 1, opacity: 1 } }]
              .sort((a, b) => a.q.depth - b.q.depth)
              .map((n) => {
                if (n.kind === "core") {
                  return (
<g key="core">
              <circle cx={CX} cy={CY} r={44} fill="rgba(76,138,245,0.10)" />
              {profiles[focusKey]?.avatar ? (
                <>
                  <clipPath id="clip-core">
                    <circle cx={CX} cy={CY} r={33} />
                  </clipPath>
                  <image href={profiles[focusKey].avatar} x={CX - 33} y={CY - 33} width={66} height={66} clipPath="url(#clip-core)" />
                </>
              ) : (
                <>
                  <circle cx={CX} cy={CY} r={33} fill="#1a2233" />
                  <text x={CX} y={CY + 6} textAnchor="middle" fill="#e8eaef" style={{ fontSize: "16px", fontWeight: 600 }}>
                    {focus.name.slice(0, 2).toUpperCase()}
                  </text>
                </>
              )}
              <circle cx={CX} cy={CY} r={33} fill="none" stroke="#4c8af5" strokeWidth={2.4} />
              <circle cx={CX} cy={CY} r={41} fill="none" stroke="rgba(76,138,245,0.4)" strokeWidth={1} />
              <text x={CX} y={CY + 58} textAnchor="middle" fill="#cdd3dd" style={{ fontSize: "12px", fontWeight: 500 }}>
                {focus.name}
              </text>
            </g>
                  );
                }
                if (n.kind === "proj") {
                  const { p, q } = n;
                  const meta = projects.find((x) => x.id === p.id);
                  const color = projectInfo[p.id]?.color ?? "#8a93a3";
                  const r = (11 + 17 * Math.sqrt(p.share)) * q.scale;
                  const isSel = selected?.id === p.id;
                  const overdue = !!meta?.deadline && !meta.doneAt && toDate(meta.deadline) < today;
                  const busFactor = p.contributors.length === 1;
                  // Labels flip to the free side: below when the node rides the
                  // lower arc, above on the upper arc — kills orbit collisions.
                  const below = q.y >= CY;
                  const ly = below ? q.y + r + 13 : q.y - r - 17;
                  return (
                    <g
                      key={`p-${p.id}`}
                      opacity={q.opacity}
                      className="cursor-pointer"
                      // pointerdown, NOT click: the drift re-sorts DOM nodes
                      // every frame, and a moved element cancels a click.
                      onPointerDown={() => setSelected({ type: "project", id: p.id })}
                    >
                      {/* Tinted planet fill — a dark disc read as an empty ring. */}
                      <circle cx={q.x} cy={q.y} r={r} fill={`${color}30`} stroke={color} strokeWidth={2 * q.scale} />
                      {r > 15 && (
                        <text
                          x={q.x}
                          y={q.y + 3.5 * q.scale}
                          textAnchor="middle"
                          fill="#e8eaef"
                          style={{ fontSize: `${9 * q.scale}px`, fontWeight: 600 }}
                        >
                          {fmtH(p.ms)}
                        </text>
                      )}
                      {meta?.doneAt && (
                        <circle cx={q.x} cy={q.y} r={r + 5} fill="none" stroke="#22c55e" strokeWidth={1.2} opacity={0.8} />
                      )}
                      {overdue && (
                        <circle cx={q.x} cy={q.y} r={r + 5} fill="none" stroke="#d97706" strokeWidth={1.3} opacity={0.9} />
                      )}
                      {busFactor && (
                        <circle cx={q.x} cy={q.y} r={r + 9} fill="none" stroke="#e24b4a" strokeWidth={1.2} strokeDasharray="3 3" opacity={0.85} />
                      )}
                      {isSel && (
                        <circle cx={q.x} cy={q.y} r={r + 13} fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth={1.2} strokeDasharray="4 4" />
                      )}
                      <text x={q.x} y={ly} textAnchor="middle" fill={color} style={{ fontSize: `${10 * q.scale}px` }}>
                        {(projectInfo[p.id]?.name ?? "?").slice(0, 24)}
                      </text>
                      {(busFactor || r <= 15) && (
                        <text
                          x={q.x}
                          y={below ? ly + 11 : ly - 10}
                          textAnchor="middle"
                          fill={busFactor ? "#e88a8a" : "#8a93a3"}
                          style={{ fontSize: `${8.5 * q.scale}px` }}
                        >
                          {r <= 15 ? `${fmtH(p.ms)}${busFactor ? " · " : ""}` : ""}
                          {busFactor ? "⚠ only them" : ""}
                        </text>
                      )}
                    </g>
                  );
                }
                const { c, q } = n;
                const r = (10 + 2.2 * Math.min(c.sharedCount, 4)) * q.scale;
                const av = profiles[c.member.userKey]?.avatar;
                return (
                  <g
                    key={`c-${c.member.userKey}`}
                    opacity={q.opacity * 0.95}
                    className="cursor-pointer"
                    onPointerDown={() => setFocusKey(c.member.userKey)}
                  >
                    {av ? (
                      <>
                        <clipPath id={`clip-${c.member.userKey}`}>
                          <circle cx={q.x} cy={q.y} r={r} />
                        </clipPath>
                        <image
                          href={av}
                          x={q.x - r}
                          y={q.y - r}
                          width={r * 2}
                          height={r * 2}
                          clipPath={`url(#clip-${c.member.userKey})`}
                        />
                        <circle cx={q.x} cy={q.y} r={r} fill="none" stroke="#aab3c2" strokeWidth={1.1} />
                      </>
                    ) : (
                      <>
                        <circle cx={q.x} cy={q.y} r={r} fill="#1c2027" stroke="#aab3c2" strokeWidth={1.1} />
                        <text x={q.x} y={q.y + 3} textAnchor="middle" fill="#cdd3dd" style={{ fontSize: `${8 * q.scale}px` }}>
                          {c.member.name.slice(0, 2).toUpperCase()}
                        </text>
                      </>
                    )}
                    <text
                      x={q.x}
                      y={q.y >= CY ? q.y + r + 11 : q.y - r - 6}
                      textAnchor="middle"
                      fill="#8a93a3"
                      style={{ fontSize: `${8.5 * q.scale}px` }}
                    >
                      {c.member.name.split(" ")[0]} · {c.sharedCount}
                    </text>
                  </g>
                );
              })}


          </svg>
        )}
        <p className="absolute bottom-2.5 left-4 z-10 text-[10px] text-[#6e7684]">
          node size = hours together · green ring = done · amber = overdue · red dashed = bus factor · click a person to re-center
        </p>
      </div>

      {/* ---- sidebar ---- */}
      <div className="w-[264px] shrink-0 overflow-y-auto border-l border-white/10 bg-[#10131a]/95 px-4 py-5">
        {selectedProject ? (
          <>
            <p className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-amber-400/90">Project · selected</p>
            <p className="text-[15px] font-semibold leading-snug">{selectedProject.name}</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {(selectedProject.tags ?? []).map((t) => (
                <span key={t} className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] text-violet-300">
                  {t}
                </span>
              ))}
            </div>
            {selectedProject.description && (
              <p className="mt-2 text-[11.5px] leading-relaxed text-[#a6adba] line-clamp-4">{selectedProject.description}</p>
            )}
            <Hr />
            <SideLabel>Vital signs</SideLabel>
            <p className="mb-1 text-[11.5px]">
              {selectedProject.doneAt ? (
                <span className="text-green-400">✓ Done</span>
              ) : selectedProject.deadline ? (
                toDate(selectedProject.deadline) < today ? (
                  <span className="text-red-400">◷ was due {selectedProject.deadline}</span>
                ) : (
                  <span className="text-[#a6adba]">◷ due {selectedProject.deadline}</span>
                )
              ) : (
                <span className="text-[#6e7684]">no schedule</span>
              )}
            </p>
            {projTasks && (
              <TaskStats tasks={projTasks} />
            )}
            <p className="text-[11.5px] text-[#a6adba]">
              Σ {fmtH(members.reduce((a, m) => a + ((m.totalByProject ?? []).find((w) => w.projectId === selectedProject.id)?.ms ?? 0), 0))} all-time ·{" "}
              {fmtH(members.reduce((a, m) => a + (m.weekByProject.find((w) => w.projectId === selectedProject.id)?.ms ?? 0), 0))} this week
            </p>
            <Hr />
            <SideLabel>Team on it</SideLabel>
            <div className="flex flex-wrap items-center gap-1.5">
              {members
                .filter((m) => (m.totalByProject ?? []).some((w) => w.projectId === selectedProject.id && w.ms > 0))
                .slice(0, 8)
                .map((m) => (
                  <button
                    key={m.userKey}
                    onClick={() => setFocusKey(m.userKey)}
                    title={m.name}
                    className={`flex h-7 w-7 items-center justify-center overflow-hidden rounded-lg border-[1.5px] bg-[#2a3142] text-[10px] ${
                      m.active?.projectId === selectedProject.id ? "border-green-500" : "border-[#3a4150]"
                    }`}
                  >
                    {profiles[m.userKey]?.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={profiles[m.userKey].avatar} alt="" className="h-full w-full object-cover" />
                    ) : (
                      m.name.slice(0, 2).toUpperCase()
                    )}
                  </button>
                ))}
            </div>
            {hasWisdom && (
              <>
                <Hr />
                <p className="flex items-center gap-1.5 text-[11.5px] text-amber-300/90">
                  <Lightbulb size={12} /> Post-mortem wisdom available
                </p>
              </>
            )}
            <Hr />
            <Link
              prefetch={false}
              href={`/projects/${encodeURIComponent(selectedProject.id)}`}
              className="inline-flex items-center gap-1 text-[11.5px] text-[#4c8af5] hover:underline"
            >
              Open project page <ExternalLink size={11} />
            </Link>
          </>
        ) : focus ? (
          <>
            {profiles[focusKey]?.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profiles[focusKey].avatar} alt="" className="mb-2.5 h-20 w-20 rounded-2xl object-cover" />
            ) : (
              <div className="mb-2.5 flex h-20 w-20 items-center justify-center rounded-2xl bg-[#2a3142] text-2xl font-semibold">
                {focus.name.slice(0, 2).toUpperCase()}
              </div>
            )}
            <p className="text-[16px] font-semibold">{focus.name}</p>
            {(profiles[focusKey]?.role ?? dirRec?.primaryRole) && (
              <p className="mt-0.5 text-[12px] text-[#a6adba]">{profiles[focusKey]?.role ?? dirRec?.primaryRole}</p>
            )}
            {dirRec && (
              <span className="mt-1.5 inline-block rounded-full bg-white/10 px-2.5 py-0.5 text-[10.5px] text-[#a6adba]">
                {dirRec.type}
              </span>
            )}
            <Hr />
            <p className={`text-[11.5px] ${statusLine.color}`}>{statusLine.text}</p>
            <p className="mt-1 text-[11.5px] text-[#a6adba]">
              {fmtH(focus.todayMs)} today · {fmtH(focus.weekMs)} this week
            </p>
            {dirRec && dirRec.capabilities.length > 0 && (
              <>
                <Hr />
                <SideLabel>Capabilities</SideLabel>
                <p className="text-[11.5px] leading-relaxed text-[#a6adba]">
                  {dirRec.capabilities.slice(0, 7).join(" · ")}
                </p>
              </>
            )}
            <Hr />
            <SideLabel>This constellation</SideLabel>
            <p className="text-[11.5px] leading-relaxed text-[#a6adba]">
              {graph?.projs.length ?? 0} projects · {fmtH(graph?.totalAll ?? 0)} all-time
              {graph && graph.collabs.length > 0 && (
                <>
                  <br />
                  Top partner: {graph.collabs[0].member.name.split(" ")[0]} ({graph.collabs[0].sharedCount} shared)
                </>
              )}
            </p>
            <Hr />
            <p className="text-[11px] text-[#6e7684]">
              <MessageSquare size={11} className="mr-1 inline -mt-0.5" />
              Click a project for its dossier · click a person to travel to their constellation.
            </p>
          </>
        ) : (
          <p className="text-[12px] text-[#6e7684]">Loading…</p>
        )}
      </div>
    </div>
  );
}

function Hr() {
  return <div className="my-3 border-t border-white/10" />;
}
function SideLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[#6e7684]">{children}</p>
  );
}

function TaskStats({ tasks }: { tasks: { status: string; kind?: string; dueDate?: string; archivedAt?: string }[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const real = tasks.filter((t) => t.kind !== "milestone" && !t.archivedAt);
  const done = real.filter((t) => t.status === "done").length;
  const open = real.filter((t) => t.status !== "done");
  const attention =
    open.filter((t) => t.status === "revision").length +
    open.filter((t) => t.status !== "revision" && t.dueDate && new Date(`${t.dueDate}T00:00:00`) < today).length;
  if (real.length === 0) return <p className="mb-1 text-[11.5px] text-[#6e7684]">no tasks yet</p>;
  return (
    <>
      <p className="mb-1 text-[11.5px] text-[#a6adba]">
        ▣ {done}/{real.length} tasks · {Math.round((done / real.length) * 100)}% done
      </p>
      {attention > 0 && (
        <p className="mb-1 text-[11.5px] text-amber-400">⚠ {attention} need attention</p>
      )}
    </>
  );
}
