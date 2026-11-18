/**
 * pdfText — local PDF text extraction with self-hosted pdf.js (lazy-loaded,
 * bundled worker). Scanned PDFs (no text layer) are detected and their pages
 * are rendered to PNG for the on-device image path (master spec §3).
 */

export interface PdfExtraction {
  /** Per-page text; a scanned page has an empty string. */
  pages: string[];
  text: string;
  /** Pages that had no text layer (need image path). */
  scannedPageIndices: number[];
}

interface PdfjsLib {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: { data: ArrayBuffer }) => {
    promise: Promise<PdfDocument>;
  };
}
interface PdfDocument {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
}
interface PdfPage {
  getTextContent: () => Promise<{ items: { str?: string; hasEOL?: boolean }[] }>;
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
}

let pdfjs: PdfjsLib | null = null;

async function loadPdfjs(): Promise<PdfjsLib> {
  if (pdfjs) return pdfjs as {
    GlobalWorkerOptions: { workerSrc: string };
    getDocument: (src: { data: ArrayBuffer }) => {
      promise: Promise<{
        numPages: number;
        getPage: (n: number) => Promise<{
          getTextContent: () => Promise<{ items: { str?: string; hasEOL?: boolean }[] }>;
          getViewport: (o: { scale: number }) => { width: number; height: number };
          render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
        }>;
      }>;
    };
  };
  const mod = (await import("pdfjs-dist")) as unknown as PdfjsLib;
  // Self-hosted worker bundled by Vite (no CDN — CSP stays strict).
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  mod.GlobalWorkerOptions.workerSrc = workerUrl;
  pdfjs = mod;
  return mod;
}

export async function extractPdf(
  file: Blob,
  opts: { renderScannedPages?: (page: number, png: Blob) => void; maxPages?: number } = {},
): Promise<PdfExtraction> {
  const lib = await loadPdfjs();
  const buf = await file.arrayBuffer();
  const doc = await lib.getDocument({ data: buf }).promise;
  const maxPages = opts.maxPages ?? Math.min(doc.numPages, 30);
  const pages: string[] = [];
  const scanned: number[] = [];

  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
      if (typeof item.str === "string") {
        text += item.str;
        if (item.hasEOL) text += "\n";
      }
    }
    pages.push(text);
    if (text.trim().length < 24) {
      scanned.push(i);
      if (opts.renderScannedPages) {
        const png = await renderPageToPng(page);
        opts.renderScannedPages(i, png);
      }
    }
  }

  return {
    pages,
    text: pages.map((p, idx) => `── Page ${idx + 1} ──\n${p}`).join("\n\n"),
    scannedPageIndices: scanned,
  };
}

async function renderPageToPng(page: PdfPage): Promise<Blob> {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("pdfText: canvas 2d context unavailable");
  await page.render({ canvasContext: ctx, viewport }).promise;
  return await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b ?? new Blob([], { type: "image/png" })), "image/png"),
  );
}
