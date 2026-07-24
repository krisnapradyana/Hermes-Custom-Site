"use client";

/**
 * Browser-side folder access via the File System Access API.
 * The directory handle lives in the browser — the remote server never sees
 * these files. Handles are persisted per project in IndexedDB and
 * re-authorized with a permission prompt on return visits (Chromium only).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type FSDir = any; // FileSystemDirectoryHandle
export type FSFile = any; // FileSystemFileHandle

const DB_NAME = "hermes-fs";
const STORE = "handles";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDirHandle(projectId: string, handle: FSDir): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, projectId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getDirHandle(projectId: string): Promise<FSDir | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(projectId);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export function supportsLocalFs(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function pickDirectory(): Promise<FSDir | null> {
  try {
    return await (window as any).showDirectoryPicker();
  } catch {
    return null; // cancelled
  }
}

export async function ensurePermission(handle: FSDir, write = false): Promise<boolean> {
  const opts = { mode: write ? "readwrite" : "read" };
  try {
    if ((await handle.queryPermission(opts)) === "granted") return true;
    return (await handle.requestPermission(opts)) === "granted";
  } catch {
    return false;
  }
}

export interface LocalEntry {
  name: string;
  isDir: boolean;
  size?: number;
}

export async function listDir(dir: FSDir): Promise<LocalEntry[]> {
  const out: LocalEntry[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (name.startsWith(".")) continue;
    if (handle.kind === "file") {
      let size: number | undefined;
      try {
        size = (await handle.getFile()).size;
      } catch {}
      out.push({ name, isDir: false, size });
    } else {
      out.push({ name, isDir: true });
    }
  }
  out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  return out;
}

export async function getFile(dir: FSDir, name: string): Promise<File | null> {
  try {
    const fh = await dir.getFileHandle(name);
    return await fh.getFile();
  } catch {
    return null;
  }
}

/** Write a file at a relative path (posix separators), creating subfolders. */
export async function writeFileDeep(root: FSDir, relPath: string, data: Blob): Promise<boolean> {
  try {
    const parts = relPath.split("/").filter(Boolean);
    const name = parts.pop();
    if (!name) return false;
    let dir = root;
    for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(data);
    await w.close();
    return true;
  } catch {
    return false;
  }
}
