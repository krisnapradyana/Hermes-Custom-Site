"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, FolderKanban, MessageSquare, HardDrive, Trash2, User } from "lucide-react";
import { useHermesStore } from "@/lib/store";
import { timeAgo } from "@/lib/format";
import { FolderInput } from "@/components/FolderInput";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { Project } from "@/lib/types";
import { ensurePermission, saveDirHandle, FSDir } from "@/lib/local-fs";

export default function ProjectsPage() {
  const projects = useHermesStore((s) => s.projects);
  const chats = useHermesStore((s) => s.chats);
  const createProject = useHermesStore((s) => s.createProject);
  const deleteProject = useHermesStore((s) => s.deleteProject);
  const loadProjects = useHermesStore((s) => s.loadProjects);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [workingFolder, setWorkingFolder] = useState("");
  const [wfOk, setWfOk] = useState(false);
  const [pickedHandle, setPickedHandle] = useState<FSDir | null>(null);
  const [creating, setCreating] = useState(false);

  const canCreate = name.trim() && wfOk;

  const handleCreate = async () => {
    if (!canCreate || creating) return;
    setCreating(true);
    try {
      // If a folder was picked, confirm access now — cancel if denied.
      if (pickedHandle) {
        const granted = await ensurePermission(pickedHandle).catch(() => false);
        if (!granted) {
          alert("Folder access was denied. Grant permission to create this project.");
          return;
        }
      }
      const project = await createProject(name.trim(), desc.trim(), {
        workingFolder: workingFolder.trim(),
      });
      // Persist the handle under the new project id so the panel opens it
      // with no extra "Connect folder" step.
      if (project && pickedHandle) await saveDirHandle(project.id, pickedHandle);

      setName("");
      setDesc("");
      setWorkingFolder("");
      setPickedHandle(null);
      setShowForm(false);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif-display text-3xl mb-1">Projects</h1>
          <p className="text-sm text-ink-soft">
            Group conversations and artifacts around a shared context.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
        >
          <Plus size={15} />
          New project
        </button>
      </div>

      {showForm && (
        <div className="mb-8 rounded-xl border border-line bg-card p-5 space-y-3">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-ink-faint"
          />
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="What is this project about?"
            className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-ink-faint"
          />
          <FolderInput
            label="Working folder"
            value={workingFolder}
            onChange={setWorkingFolder}
            onStatus={setWfOk}
            onHandle={(h) => setPickedHandle(h as FSDir)}
            placeholder="G:\My Drive\Projects\my-project"
          />
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleCreate}
              disabled={!canCreate || creating}
              className="rounded-lg bg-accent px-3.5 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {creating ? "Creating…" : "Create"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="rounded-lg px-3.5 py-1.5 text-sm text-ink-soft hover:bg-parchment-dark"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {projects.map((p) => {
          const count = chats.filter((c) => c.projectId === p.id).length;
          return (
            <div key={p.id} className="relative group">
              <button
                onClick={() => setDeleteTarget(p)}
                className="absolute top-3 right-3 z-10 p-2 rounded-lg text-ink-faint hover:text-red-500 hover:bg-parchment-dark opacity-0 group-hover:opacity-100 transition-opacity"
                title="Delete project"
              >
                <Trash2 size={15} />
              </button>
            <Link
              href={`/projects/${p.id}`}
              className="block rounded-xl border border-line bg-card p-5 hover:border-ink-faint transition-colors"
            >
              <div className="flex items-center gap-2.5 mb-2">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: `${p.color}22` }}
                >
                  <FolderKanban size={15} style={{ color: p.color }} />
                </div>
                <h2 className="font-medium">{p.name}</h2>
              </div>
              <p className="text-sm text-ink-soft line-clamp-2 mb-3">{p.description}</p>
              {p.workingFolder && (
                <div className="flex items-center gap-1.5 text-[11px] text-ink-faint font-mono mb-1.5 truncate">
                  <HardDrive size={11} className="shrink-0" />
                  {p.workingFolder}
                </div>
              )}
              <div className="flex items-center gap-1.5 text-[12px] text-ink-faint">
                <MessageSquare size={11} />
                {count} conversation{count === 1 ? "" : "s"} · created {timeAgo(p.createdAt)}
              </div>
              {p.createdBy?.name && (
                <div className="flex items-center gap-1.5 text-[11px] text-ink-faint mt-1">
                  <User size={11} />
                  by {p.createdBy.name}
                </div>
              )}
            </Link>
            </div>
          );
        })}
      </div>

      {deleteTarget && (
        <ConfirmDeleteModal
          title={`Delete "${deleteTarget.name}"?`}
          description={`This permanently removes the project, its ${
            chats.filter((c) => c.projectId === deleteTarget.id).length
          } conversation(s), and their artifacts. Files in the working folder on disk are NOT touched.`}
          onConfirm={() => {
            deleteProject(deleteTarget.id);
            setDeleteTarget(null);
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
