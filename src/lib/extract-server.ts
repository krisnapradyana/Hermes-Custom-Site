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
          tc.items
            .map((it) => ("str" in it ? (it as { str: string }).str : ""))
            .join(" ") + "\n";
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
