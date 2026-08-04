import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/user-key";
import { listByProject, getConversation } from "@/lib/conversations-store";
import { extractArtifacts } from "@/lib/extract";
import { Artifact, Attachment } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Project-wide Attachments + Artifacts, derived from the project's SHARED
 * conversations so every member sees the same history.
 *  - attachments: files uploaded by anyone into those conversations
 *  - artifacts:   substantial code/markup blocks the agent produced
 */

interface AttachmentItem extends Attachment {
  conversationId: string;
  conversationTitle: string;
  by?: string;
  at: string;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const { id } = await params;

  const metas = await listByProject(id);
  const attachments: AttachmentItem[] = [];
  const artifacts: (Artifact & { conversationId: string; by?: string })[] = [];
  let counter = 0;

  for (const meta of metas.slice(0, 100)) {
    const conv = await getConversation(meta.id);
    if (!conv) continue;
    for (const m of conv.messages) {
      if (m.role === "user") {
        for (const a of m.attachments ?? []) {
          attachments.push({
            ...a,
            conversationId: conv.id,
            conversationTitle: conv.title,
            by: conv.createdBy?.name,
            at: m.createdAt,
          });
        }
      } else if (m.content) {
        const found = extractArtifacts(
          m.content,
          conv.id,
          conv.title,
          () => `pa-${conv.id}-${counter++}`
        );
        for (const f of found) {
          artifacts.push({ ...f, conversationId: conv.id, by: conv.createdBy?.name });
        }
      }
    }
  }

  attachments.sort((a, b) => b.at.localeCompare(a.at));
  artifacts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json({ attachments, artifacts });
}
