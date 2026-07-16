"use client";

import { Artifact } from "@/lib/types";

/** Renders artifact content: live iframe for HTML, mermaid via CDN, images, code, downloads. */
export function ArtifactPreview({ artifact }: { artifact: Artifact }) {
  if (artifact.kind === "image") {
    return (
      <div className="flex items-center justify-center h-full p-4 overflow-auto">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={artifact.content}
          alt={artifact.title}
          className="max-w-full max-h-full rounded-lg"
        />
      </div>
    );
  }

  if (artifact.kind === "file") {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-ink-faint">
        <p className="text-sm">Binary file — no inline preview.</p>
        <button
          onClick={() => downloadArtifact(artifact)}
          className="rounded-lg bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover"
        >
          Download {artifact.title}
        </button>
      </div>
    );
  }

  if (artifact.kind === "html") {
    return (
      <iframe
        srcDoc={artifact.content}
        sandbox="allow-scripts"
        className="w-full h-full bg-white"
        title={artifact.title}
      />
    );
  }

  if (artifact.kind === "diagram") {
    const doc = `<!doctype html><html><body style="margin:0;display:flex;justify-content:center;padding:16px;background:white">
<pre class="mermaid">${artifact.content.replace(/</g, "&lt;")}</pre>
<script type="module">
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
mermaid.initialize({ startOnLoad: true });
</script></body></html>`;
    return (
      <iframe
        srcDoc={doc}
        sandbox="allow-scripts"
        className="w-full h-full bg-white"
        title={artifact.title}
      />
    );
  }

  return (
    <pre className="p-5 text-[13px] leading-relaxed whitespace-pre-wrap font-mono text-ink overflow-auto h-full">
      {artifact.content}
    </pre>
  );
}

export function downloadArtifact(artifact: Artifact) {
  // Data-URL artifacts (uploaded images/binaries) download directly.
  if (artifact.content.startsWith("data:")) {
    const a = document.createElement("a");
    a.href = artifact.content;
    a.download = artifact.title.replace(/[^\w.\- ]+/g, "_");
    a.click();
    return;
  }

  const ext =
    artifact.kind === "html"
      ? "html"
      : artifact.kind === "diagram"
      ? "mmd"
      : artifact.kind === "document"
      ? "md"
      : artifact.language || "txt";
  const name = artifact.title.includes(".") ? artifact.title : `${artifact.title}.${ext}`;
  const blob = new Blob([artifact.content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[^\w.\- ]+/g, "_");
  a.click();
  URL.revokeObjectURL(url);
}
