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
  rangeByProject?: { projectId: string; ms: number }[];
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

// ---- planet skins: bands + craters + shading, seeded by project id so a
// project wears the same face in every constellation, forever. -------------
const hashStr = (str: string) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};
const seededRng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
interface PlanetPat {
  bands: { y: number; h: number; tilt: number; k: number; o: number }[];
  craters: { x: number; y: number; r: number }[];
}
const patCache = new Map<string, PlanetPat>();
const patternOf = (id: string): PlanetPat => {
  const hit = patCache.get(id);
  if (hit) return hit;
  const r = seededRng(hashStr(id));
  const bands: PlanetPat["bands"] = [];
  const nb = 2 + Math.floor(r() * 2);
  for (let i = 0; i < nb; i++) {
    bands.push({ y: -0.65 + 1.3 * r(), h: 0.12 + 0.2 * r(), tilt: -10 + 20 * r(), k: r() < 0.5 ? 0.5 : 1.5, o: 0.45 + 0.35 * r() });
  }
  const craters: PlanetPat["craters"] = [];
  const nc = 2 + Math.floor(r() * 3);
  for (let i = 0; i < nc; i++) {
    const ang = r() * 6.283, d = r() * 0.55;
    craters.push({ x: Math.cos(ang) * d, y: Math.sin(ang) * d, r: 0.12 + 0.13 * r() });
  }
  const pat = { bands, craters };
  patCache.set(id, pat);
  return pat;
};
const shade = (hex: string, k: number) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = (c: number) => (k <= 1 ? Math.round(c * k) : Math.round(c + (255 - c) * Math.min(1, k - 1)));
  const R = f((n >> 16) & 255), G = f((n >> 8) & 255), B = f(n & 255);
  return `#${((R << 16) | (G << 8) | B).toString(16).padStart(6, "0")}`;
};

export default function ConstellationPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const [focusKey, setFocusKey] = useState(decodeURIComponent(key));

  // Entry choreography (approved combo): warp-dive on open, unfurl on travel.
  // Whole timeline ≤ 500ms; reduced-motion skips straight to the final frame.
  // Month navigator (option A): default = current month so constellations
  // stay uncluttered; click the label to toggle "All time".
  const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const curYm = ymOf(new Date());
  const [monthSel, setMonthSel] = useState<string | null>(curYm);
  // The month the loaded data belongs to — the graph renders ONLY this,
  // so a slow fetch can never show old hours under a new label.
  const [dataMonth, setDataMonth] = useState<string | null>(curYm);
  const shiftMonth = (m: string, d: number) => {
    const [y, mo] = m.split("-").map(Number);
    return ymOf(new Date(y, mo - 1 + d, 1));
  };
  const monthLabel = (m: string) =>
    new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const firstRun = useRef(true);
  const introRef = useRef<{ mode: "open" | "travel"; start: number }>({ mode: "open", start: 0 });
  useEffect(() => {
    if (!firstRun.current) introRef.current = { mode: "travel", start: performance.now() };
  }, [focusKey]);

  const [members, setMembers] = useState<Pulse[]>([]);
  const [projectInfo, setProjectInfo] = useState<Record<string, { name: string; color: string }>>({});
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [directory, setDirectory] = useState<DirMember[]>([]);

  useEffect(() => {
    api
      .get<{ members: Pulse[]; projects: Record<string, { name: string; color: string }> }>(
        `/api/team${monthSel ? `?month=${monthSel}` : ""}`
      )
      .then((r) => {
        if (r.ok) {
          setMembers(r.data.members);
          setProjectInfo(r.data.projects);
          setDataMonth(monthSel);
          introRef.current = { mode: firstRun.current ? "open" : "travel", start: performance.now() };
          firstRun.current = false;
        }
      });
    api.get<{ projects: ProjectMeta[] }>("/api/projects").then((r) => r.ok && setProjects(r.data.projects));
    api.get<{ profiles: Record<string, Profile> }>("/api/team/profiles").then((r) => r.ok && setProfiles(r.data.profiles));
    api.get<{ members: DirMember[] }>("/api/directory/members").then((r) => r.ok && setDirectory(r.data.members)).catch(() => {});
  }, [monthSel]);

  const focus = members.find((m) => m.userKey === focusKey);

  // ---- graph model ---------------------------------------------------------
  const graph = useMemo(() => {
    if (!focus) return null;
    const src = (m: Pulse) => (dataMonth ? (m.rangeByProject ?? []) : (m.totalByProject ?? []));
    const real = src(focus).filter(
      (w) =>
        w.ms > 0 &&
        w.projectId !== STANDBY_ID &&
        w.projectId !== GENERAL_ID &&
        // Deleted/orphaned projects keep their hours in totals and pies, but
        // don't get to be planets (the "?" nodes, field feedback).
        !!projectInfo[w.projectId]
    );
    const totalAll = real.reduce((a, w) => a + w.ms, 0);
    const projs = [...real].sort((a, b) => b.ms - a.ms).slice(0, 8);

    // Collaborators: others sharing those projects, ranked by shared count + hours.
    const projIds = new Set(projs.map((p) => p.projectId));
    const collabs = members
      .filter((m) => m.userKey !== focus.userKey)
      .map((m) => {
        const shared = src(m)
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
      members.filter((m) => src(m).some((w) => w.projectId === pid && w.ms > 0));

    return {
      projs: projs.map((p) => ({
        id: p.projectId,
        ms: p.ms,
        share: totalAll > 0 ? p.ms / totalAll : 0,
        angle: projAngle.get(p.projectId)!,
        contributors: contributors(p.projectId),
        moons: collabs
          .filter((c) => c.shared[0] === p.projectId)
          .map((c) => ({ member: c.m, sharedCount: c.shared.length })),
      })),
      // Satellite clusters (option A): each collaborator becomes a MOON of
      // their strongest shared project — stacking is geometrically impossible,
      // and the resting view stays calm (labels only bloom on focus).
      collabs: collabs.map((c) => ({ member: c.m, sharedCount: c.shared.length })),
      totalAll,
    };
  }, [focus, members, dataMonth, projectInfo]);

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

  // ---- intro animation factors (t normalized over 500ms) -------------------
  const reduced =
    typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const it = reduced || typeof performance === "undefined"
    ? 1
    : Math.min(1, (performance.now() - introRef.current.start) / 500);
  const mode = introRef.current.mode;
  const stag = (d: number, dur: number) => (it >= 1 ? 1 : Math.min(1, Math.max(0, (it - d) / dur)));
  const easeO = (t: number) => 1 - Math.pow(1 - t, 3);
  const over = (t: number) => {
    const s2 = 1.7;
    const u = t - 1;
    return 1 + u * u * ((s2 + 1) * u + s2);
  };
  const projF = (i: number) => (mode === "travel" ? easeO(stag(i * 0.05, 0.55)) : 1);
  const projO = (i: number) =>
    mode === "open" ? easeO(stag(0.3 + i * 0.05, 0.3)) : easeO(stag(i * 0.05, 0.55));
  const projPop = (i: number) =>
    mode === "open" ? Math.min(1.15, over(easeO(stag(0.3 + i * 0.05, 0.3)))) : 1;
  const orbitO = stag(0.25, 0.35);
  const coreK =
    mode === "open" ? Math.min(1.2, over(easeO(stag(0.05, 0.35)))) : 0.9 + 0.1 * over(easeO(stag(0, 0.3)));
  const starsK =
    mode === "open"
      ? { s: 0.78 + 0.22 * easeO(stag(0, 0.5)), o: 0.35 + 0.65 * stag(0, 0.4) }
      : { s: 1, o: 1 };

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

        {/* Month navigator — option A capsule. Click the label = All time. */}
        <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/15 bg-[#1c2028]/75 px-2 py-1 backdrop-blur-md">
          <button
            onClick={() => setMonthSel(monthSel ? shiftMonth(monthSel, -1) : curYm)}
            className="flex h-6 w-6 items-center justify-center rounded-full text-[#a6adba] hover:bg-white/10"
            title="Previous month"
          >
            ‹
          </button>
          <button
            onClick={() => setMonthSel(monthSel ? null : curYm)}
            className={`min-w-[128px] text-center text-[12.5px] font-medium text-[#e8eaef] hover:text-white ${
              monthSel !== dataMonth ? "animate-pulse text-[#8a93a3]" : ""
            }`}
            title={monthSel ? "Show all time" : "Back to this month"}
          >
            {monthSel ? monthLabel(monthSel) : "All time"}
          </button>
          <button
            onClick={() => monthSel && monthSel < curYm && setMonthSel(shiftMonth(monthSel, 1))}
            disabled={!monthSel || monthSel >= curYm}
            className="flex h-6 w-6 items-center justify-center rounded-full text-[#a6adba] hover:bg-white/10 disabled:cursor-default disabled:text-[#3a4150] disabled:hover:bg-transparent"
            title="Next month"
          >
            ›
          </button>
        </div>

        {!focus && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-[#6e7684]">
            {members.length === 0 ? "Charting the cosmos…" : "No clock history for this member in this period."}
          </p>
        )}

        {focus && graph && (
          <svg viewBox="0 0 620 500" className="h-full w-full" role="img">
            <title>Constellation for {focus.name}</title>
            <g
              opacity={starsK.o}
              transform={`translate(${CX} ${CY}) scale(${starsK.s}) translate(${-CX} ${-CY})`}
            >
              {stars.map((s, i) => (
                <circle key={i} cx={`${s.x}%`} cy={`${s.y}%`} r={s.r} fill={s.tint} opacity={s.o} className={s.cls} />
              ))}
            </g>
            <ellipse cx={CX} cy={CY} rx={185} ry={64} fill="none" stroke="rgba(76,138,245,0.18)" strokeWidth="1" opacity={orbitO} />

            {/* edges first, then nodes sorted far→near so depth stacks right */}
            {graph.projs.map((p, pi) => {
              const f = projF(pi);
              const q = pos(p.angle, 185 * f, 64 * f);
              const color = projectInfo[p.id]?.color ?? "#8a93a3";
              return (
                <line
                  key={`e-${p.id}`}
                  x1={CX}
                  y1={CY}
                  x2={q.x}
                  y2={q.y}
                  stroke={color}
                  strokeOpacity={(0.16 + 0.3 * q.depth) * projO(pi)}
                  strokeWidth={1 + 2.2 * p.share * q.scale}
                />
              );
            })}


            {[...graph.projs.map((p, pi) => ({ kind: "proj" as const, p, pi, q: pos(p.angle, 185 * projF(pi), 64 * projF(pi)) })),
              { kind: "core" as const, q: { x: CX, y: CY, depth: 0.5, scale: 1, opacity: 1 } }]
              .sort((a, b) => a.q.depth - b.q.depth)
              .map((n) => {
                if (n.kind === "core") {
                  return (
<g key="core" transform={`translate(${CX} ${CY}) scale(${coreK}) translate(${-CX} ${-CY})`}>
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
                  const r = (11 + 17 * Math.sqrt(p.share)) * q.scale * projPop(n.pi);
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
                      opacity={q.opacity * projO(n.pi)}
                      className="cursor-pointer"
                      // pointerdown, NOT click: the drift re-sorts DOM nodes
                      // every frame, and a moved element cancels a click.
                      onPointerDown={() => setSelected({ type: "project", id: p.id })}
                    >
                      {/* Planet skin: seeded bands + craters + light shading. */}
                      {(() => {
                        const pat = patternOf(p.id);
                        const cid = `pl-${p.id.replace(/[^\w-]/g, "_")}`;
                        return (
                          <>
                            <clipPath id={cid}>
                              <circle cx={q.x} cy={q.y} r={r} />
                            </clipPath>
                            <g clipPath={`url(#${cid})`}>
                              <circle cx={q.x} cy={q.y} r={r} fill={shade(color, 0.6)} />
                              {pat.bands.map((b, bi) => (
                                <rect
                                  key={bi}
                                  x={q.x - r * 1.2}
                                  y={q.y + b.y * r}
                                  width={r * 2.4}
                                  height={Math.max(1, b.h * r)}
                                  fill={shade(color, b.k)}
                                  opacity={b.o}
                                  transform={`rotate(${b.tilt} ${q.x} ${q.y})`}
                                />
                              ))}
                              {r > 13 &&
                                pat.craters.map((c2, ci2) => (
                                  <circle
                                    key={ci2}
                                    cx={q.x + c2.x * r}
                                    cy={q.y + c2.y * r}
                                    r={c2.r * r}
                                    fill={shade(color, 0.38)}
                                    opacity={0.85}
                                  />
                                ))}
                              <circle cx={q.x - r * 0.35} cy={q.y - r * 0.35} r={r * 1.1} fill={shade(color, 1.6)} opacity={0.18} />
                              <circle cx={q.x + r * 0.5} cy={q.y + r * 0.5} r={r * 1.15} fill="#000000" opacity={0.3} />
                            </g>
                            <circle cx={q.x} cy={q.y} r={r} fill="none" stroke={color} strokeWidth={2 * q.scale} />
                          </>
                        );
                      })()}
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
                      {/* Satellite moons — the project's people, hugging it.
                          Evenly spaced on a mini-orbit with local drift;
                          labels bloom only while this project is selected. */}
                      {p.moons.map((mo, mi) => {
                        const n2 = p.moons.length;
                        const ma =
                          (mi / n2) * Math.PI * 2 +
                          (hashStr(p.id) % 100) / 16 +
                          phase * 2.2;
                        const mr = isSel ? 10 : 5.5 * q.scale;
                        const dist = r + (isSel ? 24 : 11) + mr;
                        const mx = q.x + dist * Math.cos(ma);
                        const my = q.y + dist * 0.55 * Math.sin(ma);
                        const av = profiles[mo.member.userKey]?.avatar;
                        const onIt = mo.member.active?.projectId === p.id;
                        const mid = `mn-${p.id}-${mo.member.userKey}`.replace(/[^\w-]/g, "_");
                        return (
                          <g
                            key={mo.member.userKey}
                            className="cursor-pointer"
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              setFocusKey(mo.member.userKey);
                            }}
                          >
                            <title>{`${mo.member.name} · ${mo.sharedCount} shared`}</title>
                            {av ? (
                              <>
                                <clipPath id={mid}>
                                  <circle cx={mx} cy={my} r={mr} />
                                </clipPath>
                                <image href={av} x={mx - mr} y={my - mr} width={mr * 2} height={mr * 2} clipPath={`url(#${mid})`} />
                              </>
                            ) : (
                              <circle cx={mx} cy={my} r={mr} fill="#1c2027" />
                            )}
                            <circle
                              cx={mx}
                              cy={my}
                              r={mr}
                              fill="none"
                              stroke={onIt ? "#22c55e" : "#aab3c2"}
                              strokeWidth={onIt ? 1.6 : 1}
                            />
                            {isSel && (
                              <text x={mx} y={my + mr + 10} textAnchor="middle" fill="#cdd3dd" style={{ fontSize: "8.5px" }}>
                                {mo.member.name.split(" ")[0]} · {mo.sharedCount}
                              </text>
                            )}
                          </g>
                        );
                      })}
                      {isSel && p.moons.length > 0 && (
                        <ellipse
                          cx={q.x}
                          cy={q.y}
                          rx={r + 34}
                          ry={(r + 34) * 0.55}
                          fill="none"
                          stroke="rgba(255,255,255,0.14)"
                          strokeWidth={0.8}
                        />
                      )}
                    </g>
                  );
                }
                return null;
              })}


          </svg>
        )}
        <p className="absolute bottom-2.5 left-4 z-10 text-[10px] text-[#6e7684]">
          node size = hours together · moons = the project\u2019s people (click one to travel) · green moon ring = on it now · red dashed = bus factor
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
              {graph?.projs.length ?? 0} projects · {fmtH(graph?.totalAll ?? 0)}{" "}
              {dataMonth ? `in ${monthLabel(dataMonth).split(" ")[0]}` : "all-time"}
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
