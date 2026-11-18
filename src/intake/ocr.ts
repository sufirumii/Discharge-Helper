/**
 * ocr — photo text recognition for printed discharge papers.
 *
 * Uses the vendored Tesseract engine under public/ocr/ (loaded lazily, from
 * this origin only — no CDN). This is a classical text recogniser, NOT a
 * language model: it turns a photo into text with per-word confidence, and
 * the user always sees and can correct the text before anything is read.
 */


export interface OcrWord {
  text: string;
  confidence: number;
}

export interface OcrResult {
  text: string;
  words: OcrWord[];
}

interface TesseractWordLike {
  text: string;
  confidence: number;
}

interface TesseractResultLike {
  data: { text: string; words: TesseractWordLike[] };
}

interface TesseractWorkerLike {
  recognize: (image: Blob | string) => Promise<TesseractResultLike>;
  terminate: () => Promise<void>;
}

interface TesseractModuleLike {
  createWorker: (lang: string, oem: number, options: Record<string, string | boolean | ((p: { status: string; progress: number }) => void)>) => Promise<TesseractWorkerLike>;
}

let loading: Promise<TesseractModuleLike> | null = null;

function base(): string {
  // Vite serves public/ at the base URL; OCR files live under <base>ocr/.
  const b = import.meta.env.BASE_URL ?? "/";
  return `${b.endsWith("/") ? b : b + "/"}ocr/`;
}

async function loadEngine(): Promise<TesseractModuleLike> {
  loading ??= (async () => {
    await Promise.all([
      // The engine script is served from this origin (see public/ocr/).
      loadScript(`${base()}tesseract.min.js`),
    ]);
    const mod = (window as unknown as { Tesseract?: TesseractModuleLike }).Tesseract;
    if (!mod) throw new Error("The text recogniser could not be loaded.");
    return mod;
  })();
  return loading;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-ocr-src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Text recogniser script failed to load.")));
      return;
    }
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.dataset.ocrSrc = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("Text recogniser script failed to load."));
    document.head.appendChild(el);
  });
}

/**
 * Recognise text in a normalised image. Progress reports 0–1 for the UI.
 * Nothing leaves the device: the engine, worker, core and English data are
 * all vendored under public/ocr/.
 */
export async function recogniseImage(
  blob: Blob,
  onProgress?: (pct: number) => void,
): Promise<OcrResult> {
  const Tesseract = await loadEngine();
  const worker = await Tesseract.createWorker("eng", 1, {
    workerPath: `${base()}worker.min.js`,
    corePath: `${base()}`,
    langPath: `${base()}`,
    // The vendored eng.traineddata is not gzipped.
    gzip: false,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text" && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });
  try {
    const { data } = await worker.recognize(blob);
    return {
      text: data.text ?? "",
      words: (data.words ?? []).map((w) => ({ text: w.text, confidence: Math.round(w.confidence ?? 0) })),
    };
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}

export interface NormalizedImage {
  blob: Blob;
  /** "image/jpeg" or "image/png". */
  mimeType: string;
  width: number;
  height: number;
}

const ACCEPTED = ["image/jpeg", "image/png"];
/** Longest side cap: keeps image tokens inside the on-device budget. */
const MAX_SIDE = 1024;

export async function normalizeImage(input: Blob, maxSide = MAX_SIDE): Promise<NormalizedImage> {
  if (ACCEPTED.includes(input.type)) {
    // Still downscale large photos to respect the token budget.
    const img = await loadImage(input);
    if (Math.max(img.width, img.height) <= maxSide) {
      return { blob: input, mimeType: input.type, width: img.width, height: img.height };
    }
    return recode(img, input.type === "image/png" ? "image/png" : "image/jpeg", maxSide);
  }
  // HEIC/WebP/GIF/BMP → decode (if the browser can) → PNG.
  const img = await loadImage(input);
  return recode(img, "image/png", maxSide);
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("imageNormalize: this image could not be read in this browser (format not supported)."));
    };
    img.src = url;
  });
}

async function recode(img: HTMLImageElement, mimeType: string, maxSide: number): Promise<NormalizedImage> {
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("imageNormalize: canvas 2d context unavailable");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob(
      (b) => resolve(b ?? new Blob([], { type: mimeType })),
      mimeType,
      mimeType === "image/jpeg" ? 0.92 : undefined,
    ),
  );
  return { blob, mimeType, width, height };
}

/** Render the sample "image version" of a paste text (decision #42). */
export async function textToImage(lines: string[], title: string): Promise<Blob> {
  const width = 820;
  const lineHeight = 26;
  const canvas = document.createElement("canvas");
  const ctx0 = canvas.getContext("2d");
  if (!ctx0) throw new Error("textToImage: canvas unavailable");
  const wrapped = wrapLines(ctx0, lines, width - 80);
  canvas.width = width;
  canvas.height = Math.max(600, wrapped.length * lineHeight + 120);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("textToImage: canvas unavailable");
  ctx.fillStyle = "#fdfbf6";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1c2421";
  ctx.font = "600 26px Georgia, serif";
  ctx.fillText(title, 40, 60);
  ctx.font = "17px Georgia, serif";
  ctx.fillStyle = "#2b322e";
  wrapped.forEach((line, i) => ctx.fillText(line, 40, 110 + i * lineHeight));
  return await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b ?? new Blob([], { type: "image/png" })), "image/png"),
  );
}

function wrapLines(ctx: CanvasRenderingContext2D, lines: string[], maxWidth: number): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    let line = "";
    for (const word of raw.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    out.push(line);
  }
  return out;
}
