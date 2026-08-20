/**
 * Server-side document text extraction (runs in the /api/hermes proxy).
 * The Hermes API only accepts images + text inline, so PDFs, Word docs and
 * spreadsheets are converted to text here before forwarding.
 */

import mammoth from "mammoth";
import * as XLSX from "xlsx";

export async function extractDocumentText(
  name: string,
  type: string,
  buf: Buffer
): Promise<string | null> {
  const lower = name.toLowerCase();
  try {
    // PDF (pdfjs-dist handles modern xref/compression formats)
    if (type === "application/pdf" || lower.endsWith(".pdf")) {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const doc = await pdfjs.getDocument({
        data: new Uint8Array(buf),
        useSystemFonts: true,
      }).promise;
      let text = "";
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const tc = await page.getTextContent();
        text +=
          tc.items.map((it) => ("str" in it ? (it as { str: string }).str : "")).join(" ") + "\n";
      }
      const trimmed = text.trim();
      return trimmed.length > 20 ? trimmed : null; // scanned PDFs yield ~nothing
    }

    // Word (.docx)
    if (
      lower.endsWith(".docx") ||
      type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const res = await mammoth.extractRawText({ buffer: buf });
      return res.value?.trim() || null;
    }

    // Excel (.xlsx / .xls) → CSV per sheet
    if (
      /\.(xlsx|xls)$/.test(lower) ||
      type.includes("spreadsheetml") ||
      type === "application/vnd.ms-excel"
    ) {
      const wb = XLSX.read(buf, { type: "buffer" });
      const parts = wb.SheetNames.map(
        (n) => `## Sheet: ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`
      );
      const text = parts.join("\n\n").trim();
      return text || null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Fallback for PDFs with no text layer (scanned docs, design decks exported
 * as flattened images): render the first pages to JPEG data URLs so the
 * agent's vision can read them instead of getting "no extractable text".
 */
const PDF_IMG_MAX_PAGES = 8;
const PDF_IMG_EDGE = 1536; // match the provider's image-dimension sweet spot

export async function pdfPagesToImages(
  buf: Buffer,
  maxPages = PDF_IMG_MAX_PAGES
): Promise<string[]> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const { createCanvas } = await import("@napi-rs/canvas");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true })
      .promise;
    const out: string[] = [];
    const pages = Math.min(doc.numPages, maxPages);
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2, PDF_IMG_EDGE / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d");
      // PDFs assume white paper; without this, transparent areas turn black in JPEG.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      const jpeg = canvas.toBuffer("image/jpeg", 80);
      out.push(`data:image/jpeg;base64,${jpeg.toString("base64")}`);
    }
    return out;
  } catch (err) {
    console.warn(
      `[extract] pdf→images fallback failed: ${err instanceof Error ? err.message : err}`
    );
    return [];
  }
}
