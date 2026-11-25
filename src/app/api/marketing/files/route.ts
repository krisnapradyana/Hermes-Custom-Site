import { NextRequest, NextResponse } from "next/server";
import { requireMarketingAccess } from "@/lib/marketing-access";
import { deleteFile, fileUrl, saveFile } from "@/lib/marketing/files-store";
import { MAX_ASSETS, addUpload, readCards } from "@/lib/marketing/pipeline-store";
import { uid } from "@/lib/uid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Upload one preview onto a pipeline card: multipart form with `card` (id)
 * and `file`. Images and PDFs only, 10 MB — see files-store.
 */
export async function POST(req: NextRequest) {
  const gate = await requireMarketingAccess();
  if (gate.denied) return gate.denied;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Upload failed — try again" }, { status: 400 });
  }
  const cardId = form.get("card");
  const file = form.get("file");
  if (typeof cardId !== "string" || !(file instanceof File)) {
    return NextResponse.json({ error: "Missing card or file" }, { status: 400 });
  }
  const card = (await readCards()).find((c) => c.id === cardId);
  if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });
  if (card.assets.length >= MAX_ASSETS) {
    return NextResponse.json({ error: `A card holds at most ${MAX_ASSETS} assets` }, { status: 409 });
  }

  const saved = await saveFile(file.type, Buffer.from(await file.arrayBuffer()));
  if ("error" in saved) return NextResponse.json({ error: saved.error }, { status: 400 });

  const label = file.name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 140) || "Upload";
  const updated = await addUpload(
    cardId,
    { id: uid("as"), label, url: fileUrl(saved.id), type: file.type },
    gate.viewer.name
  );
  if (!updated) {
    await deleteFile(saved.id); // card vanished or filled up meanwhile — don't leave the bytes behind
    return NextResponse.json({ error: "Could not attach the file" }, { status: 409 });
  }
  return NextResponse.json({ card: updated });
}
