"use client";

import { Artifact } from "@/lib/types";

/** Renders artifact content: live iframe for HTML, mermaid diagrams via CDN, code otherwise. */
export function ArtifactPreview({ artifact }: { artifact: Artifact }) {
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
