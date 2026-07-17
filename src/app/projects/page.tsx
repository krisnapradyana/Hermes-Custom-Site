"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, FolderKanban, MessageSquare, HardDrive } from "lucide-react";
import { useHermesStore } from "@/lib/store";
import { timeAgo } from "@/lib/format";
import { FolderInput } from "@/components/FolderInput";

export default function ProjectsPage() {
  const projects = useHermesStore((s) => s.projects);
  const chats = useHermesStore((s) => s.chats);
  const createProject = useHermesStore((s) => s.createProject);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [workingFolder, setWorkingFolder] = useState("");
  const [driveFolder, setDriveFolder] = useState("");
  const [wfOk, setWfOk] = useState(false);
  const [dfOk, setDfOk] = useState(true); // optional — empty counts as ok

  const canCreate = name.trim() && wfOk && dfOk;

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
            placeholder="E:\Projects\my-project"
          />
          <FolderInput
            label="Google Drive folder"
            optional
            value={driveFolder}
            onChange={setDriveFolder}
            onStatus={setDfOk}
            placeholder="G:\My Drive\ProjectAssets"
          />
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => {
                if (!canCreate) return;
                createProject(name.trim(), desc.trim(), {
                  workingFolder: workingFolder.trim(),
                  driveFolder: driveFolder.trim() || undefined,
                });
                setName("");
                setDesc("");
                setWorkingFolder("");
                setDriveFolder("");
                setShowForm(false);
              }}
              disabled={!canCreate}
              className="rounded-lg bg-accent px-3.5 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-40"
            >
              Create
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
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="rounded-xl border border-line bg-card p-5 hover:border-ink-faint transition-colors"
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
            </Link>
          );
        })}
      </div>
    </div>
  );
}
