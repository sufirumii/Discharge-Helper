/**
 * Add papers (#/add) — Paste / Upload / Samples tabs. Every input becomes an
 * editable document: the extracted text is shown in a "Check the text before
 * we read it" editor, then the real reading engine runs at the press of a
 * button with live progress. Photos use the built-in text recogniser and
 * words it read uncertainly are wrapped in ⟦ ⟧ for the user to check.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { Button, Card, Tabs } from "../components";
import { t } from "@/i18n";
import { SAMPLES } from "@/sample";
import { extractPdf } from "@/intake/pdfText";
import { normalizeImage } from "@/intake/ocr";
import { searchLexicon } from "@/engine/lexicon";
import type { BeforeMed } from "@/engine/types";
import { MAX_FILE_BYTES, MAX_PASTE_CHARS, lowConfidenceWords, markLowConfidence, type OcrResult, type OcrWord } from "../lib";

// The recogniser module may not exist yet in every build — resolve it lazily
// and fail politely when it is absent.
type OcrModule = {
  recogniseImage: (blob: Blob, onProgress?: (pct: number) => void) => Promise<OcrResult>;
};
const OCR_LOADERS = import.meta.glob<OcrModule>("@/intake/ocr.ts");

async function loadRecogniser(): Promise<OcrModule | null> {
  const loader = Object.values(OCR_LOADERS)[0];
  if (!loader) return null;
  try {
    return await loader();
  } catch {
    return null;
  }
}

let uploadSeq = 0;

export function Add() {
  const { state, setDocs, addDoc, removeDoc, setDocText, setBefore, runAnalysis, loadSample, clearAll, toast } = useStore();
  const lang = state.options.language;
  const [tab, setTab] = useState<string>("paste");
  const [uploadLabel, setUploadLabel] = useState<string | null>(null);
  const [lowWords, setLowWords] = useState<OcrWord[]>([]);
  const [lowWordsDoc, setLowWordsDoc] = useState<string | null>(null);

  const doc0 = state.docs[0];
  const editorText = doc0?.text ?? "";
  const hasText = editorText.trim().length > 0;

  const totalChars = state.docs.reduce((n, d) => n + d.text.length, 0);

  async function handleFiles(files: FileList | null) {
    for (const file of Array.from(files ?? [])) {
      if (file.size > MAX_FILE_BYTES) {
        toast("warn", t("ui.add.tooBig", lang));
        continue;
      }
      try {
        if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
          await handlePdf(file);
        } else if (file.type === "text/plain" || /\.txt$/i.test(file.name)) {
          await handleTxt(file);
        } else if (file.type.startsWith("image/")) {
          await handleImage(file);
        } else {
          toast("warn", t("ui.add.unsupported", lang));
        }
      } catch (err) {
        toast("error", `${t("ui.add.fileFailed", lang)} ${err instanceof Error ? err.message : ""}`.trim());
      } finally {
        setUploadLabel(null);
      }
    }
  }

  async function handleTxt(file: File) {
    setUploadLabel(t("ui.add.upload.working", lang));
    const text = await file.text();
    if (text.length > MAX_PASTE_CHARS) {
      toast("warn", t("ui.add.tooLong", lang));
      return;
    }
    commitText(file.name, "txt", text);
  }

  async function handlePdf(file: File) {
    setUploadLabel(t("ui.add.upload.working", lang));
    const scannedPngs: Blob[] = [];
    const extraction = await extractPdf(file, {
      renderScannedPages: (_page, png) => {
        scannedPngs.push(png);
      },
    });
    let text = extraction.text;
    if (extraction.scannedPageIndices.length > 0 && scannedPngs.length > 0) {
      const ocr = await loadRecogniser();
      if (ocr) {
        const parts: string[] = [];
        const words: OcrWord[] = [];
        for (const png of scannedPngs) {
          const result = await ocr.recogniseImage(png);
          parts.push(result.text);
          words.push(...result.words);
        }
        text = [text, ...parts].join("\n\n");
        if (words.length > 0) {
          setLowWords(lowConfidenceWords(words));
        }
      }
    }
    if (text.replace(/── Page \d+ ──/g, "").trim().length === 0) {
      toast("warn", t("ui.add.pdfEmpty", lang));
      return;
    }
    if (text.length > MAX_PASTE_CHARS) {
      toast("warn", t("ui.add.tooLong", lang));
      return;
    }
    commitText(file.name, "pdf-text", text);
  }

  async function handleImage(file: File) {
    const ocr = await loadRecogniser();
    if (!ocr) {
      toast("warn", t("ui.add.photo.unavailable", lang));
      return;
    }
    setUploadLabel(t("ui.add.photo.progress", lang));
    const norm = await normalizeImage(file);
    const result = await ocr.recogniseImage(norm.blob, (pct) => {
      setUploadLabel(`${t("ui.add.photo.progress", lang)} ${pct}%`);
    });
    if (!result.text.trim()) {
      toast("warn", t("ui.add.photoEmpty", lang));
      return;
    }
    setLowWords(lowConfidenceWords(result.words));
    commitText(file.name, "photo", markLowConfidence(result.text, result.words));
  }

  function commitText(label: string, kind: "paste" | "pdf-text" | "txt" | "photo", text: string) {
    uploadSeq += 1;
    const id = `doc-${Date.now()}-${uploadSeq}`;
    addDoc({ id, kind, label, text });
    setLowWordsDoc(id);
    toast("success", t("ui.add.added", lang, { label }));
  }

  return (
    <>
      <h1>{t("ui.add.title", lang)}</h1>
      <p>{t("ui.add.intro", lang)}</p>

      <Tabs
        label={t("ui.add.title", lang)}
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "paste", label: t("ui.add.tab.paste", lang) },
          { id: "upload", label: t("ui.add.tab.upload", lang) },
          { id: "samples", label: t("ui.add.tab.samples", lang) },
        ]}
      />

      {tab === "paste" ? <PasteTab lang={lang} onUse={(text) => {
        if (text.length > MAX_PASTE_CHARS) {
          toast("warn", t("ui.add.tooLong", lang));
          return;
        }
        setDocs([{ id: `doc-paste-${Date.now()}`, kind: "paste", label: t("ui.add.paste.docLabel", lang), text }]);
        toast("success", t("ui.add.paste.added", lang));
      }} /> : null}

      {tab === "upload" ? (
        <Card>
          <label className="dh-label" htmlFor="dh-file">
            {t("ui.add.upload.label", lang)}
          </label>
          <input
            id="dh-file"
            type="file"
            multiple
            className="dh-filepick"
            accept=".pdf,.txt,text/plain,application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <p className="dh-hint">{t("ui.add.upload.hint", lang)}</p>
          <p className="dh-hint">📷 {t("ui.add.photo.note", lang)}</p>
          {uploadLabel ? (
            <p className="dh-busy-row" role="status" aria-live="polite">
              <span className="dh-spinner" aria-hidden>
                <span className="dh-spinner-dot" />
              </span>
              <span>{uploadLabel}</span>
            </p>
          ) : null}
        </Card>
      ) : null}

      {tab === "samples" ? (
        <>
          <p>{t("ui.add.samples.hint", lang)}</p>
          <div className="dh-steps">
            {SAMPLES.map((s) => (
              <Card key={s.id} title={s.label} as="article">
                <p className="dh-sample-meta">
                  <strong>{s.patient}</strong>
                  <br />
                  {s.facility}
                </p>
                <p>{s.why}</p>
                <Button size="sm" variant="secondary" onClick={() => loadSample(s.id)}>
                  {t("ui.add.samples.use", lang)}
                </Button>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {doc0 ? (
        <section className="dh-editor-section" aria-labelledby="dh-editor-title">
          <h2 id="dh-editor-title">{t("ui.add.editor.title", lang)}</h2>
          <p className="dh-hint">{t("ui.add.editor.hint", lang)}</p>
          <label className="sr-only" htmlFor="dh-editor">
            {t("ui.add.editor.title", lang)}
          </label>
          <textarea
            id="dh-editor"
            className="dh-textarea dh-editor"
            value={editorText}
            onChange={(e) => setDocText(doc0.id, e.target.value)}
            spellCheck={false}
          />
          <p className="dh-editor-count" aria-live="polite">
            {t("ui.add.chars", lang, { count: editorText.length })}
          </p>
          {lowWordsDoc === doc0.id && lowWords.length > 0 ? (
            <div className="dh-lowconf">
              <p className="dh-lowconf-legend">{t("ui.add.lowconf.legend", lang)}</p>
              <ul className="dh-lowconf-list">
                {lowWords.slice(0, 24).map((w, i) => (
                  <li key={`${w.text}-${i}`}>
                    ⟦{w.text}⟧ <span className="dh-lowconf-pct">{Math.round(w.confidence)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {state.docs.length > 1 ? (
            <div className="dh-docs">
              <h3 className="dh-docs-title">{t("ui.add.docs", lang)}</h3>
              <p className="dh-hint">{t("ui.add.docsHint", lang)}</p>
              <ul className="dh-docs-list">
                {state.docs.map((d, i) => (
                  <li key={d.id} className={i === 0 ? "dh-doc-chip dh-doc-first" : "dh-doc-chip"}>
                    <span>
                      {d.label}
                      <span className="dh-doc-kind"> · {d.kind}</span>
                    </span>
                    <button
                      type="button"
                      className="dh-doc-remove"
                      onClick={() => removeDoc(d.id)}
                      aria-label={t("ui.add.removeDoc", lang) + ": " + d.label}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="dh-hint">
            <button type="button" className="dh-btn dh-btn-ghost dh-btn-sm" onClick={clearAll}>
              {t("ui.add.startOver", lang)}
            </button>
          </p>
        </section>
      ) : null}

      <BeforeListEditor
        before={state.before}
        detected={state.result?.beforeDetected ?? null}
        lang={lang}
        onChange={setBefore}
      />

      {state.busy ? <ProgressPanel /> : null}

      <div className="dh-read-cta">
        <Button size="lg" disabled={!hasText || state.busy} loading={state.busy} onClick={() => void runAnalysis()}>
          {state.busy ? state.progressLabel || t("ui.add.reading", lang) : t("ui.add.read", lang)}
        </Button>
        {totalChars > MAX_PASTE_CHARS ? (
          <p className="dh-warn-line">{t("ui.add.totalTooLong", lang)}</p>
        ) : null}
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Paste tab

function PasteTab({ lang, onUse }: { lang: "en" | "hi" | "te"; onUse: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <Card>
      <label className="dh-label" htmlFor="dh-paste">
        {t("ui.add.paste.label", lang)}
      </label>
      <p className="dh-hint">{t("ui.add.paste.hint", lang)}</p>
      <textarea
        id="dh-paste"
        className="dh-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("ui.add.paste.placeholder", lang)}
      />
      <p className="dh-editor-count" aria-live="polite">
        {t("ui.add.chars", lang, { count: text.length })}
      </p>
      <Button disabled={text.trim().length === 0} onClick={() => onUse(text)}>
        {t("ui.add.paste.use", lang)}
      </Button>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Before-list editor with lexicon typeahead

function BeforeListEditor({
  before,
  detected,
  lang,
  onChange,
}: {
  before: BeforeMed[];
  detected: BeforeMed[] | null;
  lang: "en" | "hi" | "te";
  onChange: (before: BeforeMed[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => (query.trim().length >= 2 ? searchLexicon(query.trim(), 6) : []), [query]);

  const addMed = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (before.some((b) => b.name.toLowerCase() === trimmed.toLowerCase())) return;
    onChange([...before, { name: trimmed }]);
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <section className="dh-before" aria-labelledby="dh-before-title">
      <h2 id="dh-before-title">{t("ui.add.before.title", lang)}</h2>
      <p className="dh-hint">{t("ui.add.before.hint", lang)}</p>
      {detected && detected.length > 0 ? <p className="dh-detected-note">📋 {t("ui.add.before.detected", lang)}</p> : null}

      <div className="dh-combobox">
        <label className="dh-label" htmlFor="dh-before-input">
          {t("ui.add.before.typeahead", lang)}
        </label>
        <input
          id="dh-before-input"
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && results.length > 0) {
              e.preventDefault();
              setActive((a) => (a + 1) % results.length);
            } else if (e.key === "ArrowUp" && results.length > 0) {
              e.preventDefault();
              setActive((a) => (a - 1 + results.length) % results.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              addMed(results[active]?.label ?? query);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={t("ui.add.before.placeholder", lang)}
        />
        {open && results.length > 0 ? (
          <ul id={listId} role="listbox" className="dh-combobox-list" onMouseDown={(e) => e.preventDefault()}>
            {results.map((r, i) => (
              <li key={r.label} role="option" aria-selected={i === active} className={i === active ? "dh-combobox-active" : undefined}>
                <button
                  type="button"
                  className="dh-combobox-pick"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => addMed(r.label)}
                  tabIndex={-1}
                >
                  <strong>{r.label}</strong>
                  <span className="dh-combobox-sub">{r.ingredients.join(" + ")}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {before.length === 0 ? (
        <p className="dh-hint">{t("ui.add.before.empty", lang)}</p>
      ) : (
        <ul className="dh-before-list">
          {before.map((b, i) => (
            <li key={`${b.name}-${i}`} className="dh-before-row">
              <label className="sr-only" htmlFor={`dh-before-name-${i}`}>
                {t("ui.add.before.name", lang)}
              </label>
              <input
                id={`dh-before-name-${i}`}
                type="text"
                value={b.name}
                onChange={(e) => {
                  const next = [...before];
                  next[i] = { ...b, name: e.target.value };
                  onChange(next);
                }}
              />
              <button
                type="button"
                className="dh-doc-remove"
                onClick={() => onChange(before.filter((_, j) => j !== i))}
                aria-label={t("ui.add.before.remove", lang) + ": " + b.name}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Live progress while the engine runs

function ProgressPanel() {
  const { state } = useStore();
  const lang = state.options.language;
  const ref = useRef<HTMLDivElement>(null);
  const recent = state.traceSteps.slice(-6);

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [state.traceSteps.length]);

  return (
    <Card tone="accent" title={state.progressLabel || t("ui.add.reading", lang)}>
      <div className="dh-busy-row">
        <span className="dh-spinner" aria-hidden>
          <span className="dh-spinner-dot" />
        </span>
        <div className="dh-progress-steps-wrap" ref={ref} role="log" aria-live="polite">
          <ul className="dh-progress-steps">
            {recent.map((s) => (
              <li key={s.id}>{s.label}</li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}
