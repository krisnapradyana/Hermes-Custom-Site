"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ListChecks, CalendarRange } from "lucide-react";
import { useHermesStore } from "@/lib/store";
import { TaskBoard, Task } from "@/components/TaskBoard";
import { ProjectTimeline } from "@/components/ProjectTimeline";

/** Dedicated task board — its own page, deliberately separate from chats. */
export default function ProjectTasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const project = useHermesStore((s) => s.projects.find((p) => p.id === id));
  const loadProjects = useHermesStore((s) => s.loadProjects);
  const [tasks, setTasks] = useState<Task[]>([]);
  const onTasks = useCallback((t: Task[]) => setTasks(t), []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const fmtDate = (iso?: string) =>
    iso
      ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : null;

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <Link
        prefetch={false}
        href={`/projects/${encodeURIComponent(id)}`}
        className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink mb-6"
      >
        <ArrowLeft size={14} />
        {project?.name ?? "Back to project"}
      </Link>

      <div className="flex items-center gap-3 mb-1">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: `${project?.color ?? "#2a73e1"}22` }}
        >
          <ListChecks size={18} style={{ color: project?.color ?? "#2a73e1" }} />
        </div>
        <h1 className="font-serif-display text-3xl">Task Board</h1>
      </div>
      <p className="text-sm text-ink-soft mb-2">{project?.name}</p>
      {(project?.startDate || project?.deadline) && (
        <p className="flex items-center gap-1.5 text-[12px] text-ink-faint mb-6">
          <CalendarRange size={12} />
          {fmtDate(project?.startDate) ?? "…"} → {fmtDate(project?.deadline) ?? "…"}
        </p>
      )}
      {!project?.startDate && !project?.deadline && <div className="mb-6" />}

      <ProjectTimeline
        tasks={tasks}
        projectStart={project?.startDate}
        projectDeadline={project?.deadline}
      />

      <TaskBoard projectId={id} onTasks={onTasks} />
    </div>
  );
}
