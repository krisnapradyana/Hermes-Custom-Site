import { NextRequest, NextResponse } from "next/server";
import { watch, FSWatcher } from "fs";
import { getUserKey } from "@/lib/user-key";
import { isAllowedRoot } from "@/lib/fs-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SSE stream of filesystem events for a registered project folder.
 * Uses fs.watch (recursive) — catches agent-generated files and external
 * changes (Explorer, Drive sync, other apps). Events are debounced and
 * batched so bursts (e.g. a build) arrive as one update.
 */
export async function GET(req: NextRequest) {
  const key = await getUserKey();
  if (!key) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const root = req.nextUrl.searchParams.get("root") ?? "";
  if (!root || !(await isAllowedRoot(key, root))) {
    return NextResponse.json({ error: "Folder is not registered on any project" }, { status: 403 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          closed = true;
        }
      };

      send({ type: "ready" });

      let pending = new Set<string>();
      let timer: ReturnType<typeof setTimeout> | null = null;
      let watcher: FSWatcher | null = null;

      try {
        watcher = watch(root, { recursive: true }, (_event, filename) => {
          pending.add(String(filename ?? "").replace(/\\/g, "/"));
          if (!timer) {
            timer = setTimeout(() => {
              send({ type: "change", paths: [...pending].slice(0, 50) });
              pending = new Set();
              timer = null;
            }, 400);
          }
        });
      } catch {
        send({ type: "error", message: "Could not watch this folder" });
      }

      const heartbeat = setInterval(() => send({ type: "ping" }), 25_000);

      const close = () => {
        closed = true;
        clearInterval(heartbeat);
        if (timer) clearTimeout(timer);
        watcher?.close();
        try {
          controller.close();
        } catch {}
      };
      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
