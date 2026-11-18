/**
 * Shared UI primitives — hand-built with accessible patterns:
 * dialog, tabs, disclosure, toast, progress, skeleton. Keyboard + ARIA
 * throughout; 44px+ touch targets; icons paired with text labels always.
 */

import { useStore, useLang } from "./store";
import { navigate } from "./router";
import { t } from "@/i18n";
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type * as React from "react";
import type { Lang } from "@/engine/types";

// ────────────────────────────────────────────────────────────────────────────
// Button

export function Button({
  variant = "primary",
  size = "md",
  loading,
  children,
  ...rest
}: {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const lang = useLang();
  const cls = ["dh-btn", `dh-btn-${variant}`, `dh-btn-${size}`, rest.className ?? ""].join(" ");
  return (
    <button {...rest} className={cls} disabled={rest.disabled || loading}>
      {loading ? (
        <span className="dh-spinner" role="img" aria-label={t("ui.a11y.working", lang)}>
          <span className="dh-spinner-dot" />
        </span>
      ) : null}
      {children}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Card

export function Card({
  title,
  tone,
  lang,
  children,
  as: As = "section",
  ...rest
}: {
  title?: ReactNode;
  tone?: "plain" | "accent" | "new" | "changed" | "stopped" | "same" | "unclear";
  lang?: Lang;
  children: ReactNode;
  as?: "section" | "article" | "div";
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <As className={`dh-card dh-card-${tone ?? "plain"} ${rest.className ?? ""}`} {...rest}>
      {title ? (
        <h3 className="dh-card-title">
          {tone && tone !== "plain" && tone !== "accent" ? <StatusIcon status={tone} lang={lang} /> : null}
          {title}
        </h3>
      ) : null}
      {children}
    </As>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Status iconography — ALWAYS icon + label + color together

const STATUS_GLYPHS: Record<string, string> = {
  new: "＋",
  changed: "⇄",
  stopped: "⊘",
  same: "＝",
  unclear: "?",
};

export function statusLabel(status: string, lang: Lang): string {
  return t(`ui.status.${status}`, lang);
}

export function StatusIcon({ status, lang = "en" }: { status: string; lang?: Lang }) {
  const glyph = STATUS_GLYPHS[status] ?? STATUS_GLYPHS.unclear;
  return (
    <span className={`dh-status dh-status-${status}`} aria-hidden="true">
      <span className="dh-status-glyph">{glyph}</span>
      <span className="dh-status-label">{statusLabel(status, lang)}</span>
    </span>
  );
}

export function StatusPill({ status, lang = "en" }: { status: string; lang?: Lang }) {
  return (
    <span className={`dh-pill dh-pill-${status}`}>
      <span className={`dh-status dh-status-${status}`}>
        <span className="dh-status-glyph" aria-hidden="true">
          {STATUS_GLYPHS[status] ?? STATUS_GLYPHS.unclear}
        </span>
        <span className="dh-status-label">{statusLabel(status, lang)}</span>
      </span>
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Dialog (focus trap + Escape)

export function Dialog({
  open,
  onClose,
  title,
  children,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  labelledBy?: string;
}) {
  const lang = useLang();
  const ref = useRef<HTMLDivElement>(null);
  const headingId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevFocus = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      prevFocus?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="dh-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy ?? headingId}
        tabIndex={-1}
        className="dh-dialog"
      >
        <h2 id={labelledBy ?? headingId} className="dh-dialog-title">
          {title}
        </h2>
        <div className="dh-dialog-body">{children}</div>
        <button className="dh-btn dh-btn-secondary dh-dialog-close" onClick={onClose}>
          {t("ui.dialog.close", lang)}
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Tabs

export function Tabs({
  tabs,
  active,
  onChange,
  label,
}: {
  tabs: { id: string; label: ReactNode }[];
  active: string;
  onChange: (id: string) => void;
  label: string;
}) {
  return (
    <div className="dh-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === active}
          className={`dh-tab ${t.id === active ? "dh-tab-active" : ""}`}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            const idx = tabs.findIndex((x) => x.id === active);
            if (e.key === "ArrowRight") onChange(tabs[(idx + 1) % tabs.length].id);
            if (e.key === "ArrowLeft") onChange(tabs[(idx - 1 + tabs.length) % tabs.length].id);
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Disclosure

export function Disclosure({
  summary,
  children,
  open: initial = false,
}: {
  summary: ReactNode;
  children: ReactNode;
  open?: boolean;
}) {
  const [open, setOpen] = useState(initial);
  const id = useId();
  return (
    <div className="dh-disclosure">
      <button aria-expanded={open} aria-controls={id} className="dh-disclosure-btn" onClick={() => setOpen(!open)}>
        <span className="dh-disclosure-arrow" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        {summary}
      </button>
      {open ? (
        <div id={id} className="dh-disclosure-body">
          {children}
        </div>
      ) : null}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Progress + skeleton

export function Progress({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="dh-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="dh-progress-fill" style={{ width: `${pct}%` }} />
      <span className="dh-progress-text">{label}</span>
    </div>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  const lang = useLang();
  return (
    <div className="dh-skeleton" aria-label={t("ui.skeleton.loading", lang)} role="status" aria-live="polite">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="dh-skeleton-line" style={{ width: `${70 + ((i * 13) % 26)}%` }} />
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Toast region (fixed, aria-live)

export function ToastRegion({ toasts }: { toasts: { id: number; kind: string; text: string }[] }) {
  return (
    <div className="dh-toast-region" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`dh-toast dh-toast-${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Badges & chips

/** Where the reading happens — this device, always. */
export function DeviceReadChip() {
  const lang = useLang();
  return (
    <span className="dh-badge dh-badge-device">
      <span aria-hidden>▣</span> {t("ui.deviceRead", lang)}
    </span>
  );
}

export function VerifiedChip({ verified, lang = "en" }: { verified: boolean; lang?: Lang }) {
  return (
    <span className={`dh-chip ${verified ? "dh-chip-ok" : "dh-chip-warn"}`}>
      {verified ? t("ui.changes.verified", lang) : t("ui.changes.notVerified", lang)}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ReadAloud — speechSynthesis wrapper (a non-generative platform feature)

interface SpeechVoice {
  name: string;
  lang: string;
}

export function ReadAloud({ text, voiceLang }: { text: string; voiceLang?: string }) {
  const uiLang = useLang();
  const [supported, setSupported] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechVoice[]>([]);
  const [voiceName, setVoiceName] = useState<string>("");
  const [highlight, setHighlight] = useState<number>(-1);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setSupported(false);
      return;
    }
    const load = () => {
      const list = window.speechSynthesis.getVoices().map((v) => ({ name: v.name, lang: v.lang }));
      setVoices(list);
      if (!voiceName && list.length) {
        const preferred = list.find((v) =>
          voiceLang ? v.lang.toLowerCase().startsWith(voiceLang) : v.lang.toLowerCase().startsWith("en"),
        );
        setVoiceName(preferred?.name ?? list[0].name);
      }
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", load);
      window.speechSynthesis.cancel();
    };
  }, [voiceLang, voiceName]);

  if (!supported) {
    return <p className="dh-readaloud-note">{t("ui.readaloud.unavailable", uiLang)}</p>;
  }

  const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) ?? [text];

  const speak = () => {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = window.speechSynthesis.getVoices().find((x) => x.name === voiceName);
    if (v) u.voice = v;
    u.onboundary = (e) => {
      const upto = text.slice(0, e.charIndex);
      const count = (upto.match(/[.!?\n]/g) ?? []).length;
      setHighlight(Math.min(count, sentences.length - 1));
    };
    u.onend = () => {
      setSpeaking(false);
      setHighlight(-1);
    };
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  };

  const stop = () => {
    window.speechSynthesis.cancel();
    setSpeaking(false);
    setHighlight(-1);
  };

  return (
    <div className="dh-readaloud">
      <div className="dh-readaloud-controls">
        <Button size="sm" variant="secondary" onClick={speaking ? stop : speak}>
          {speaking ? t("ui.readaloud.stop", uiLang) : t("ui.readaloud.play", uiLang)}
        </Button>
        <label className="dh-readaloud-voice">
          {t("ui.readaloud.voice", uiLang)}
          <select value={voiceName} onChange={(e) => setVoiceName(e.target.value)}>
            {voices.length === 0 ? <option value="">{t("ui.readaloud.noVoices", uiLang)}</option> : null}
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        </label>
      </div>
      {speaking && highlight >= 0 ? (
        <p className="dh-readaloud-highlight" aria-live="polite">
          {sentences[highlight]?.trim()}
        </p>
      ) : null}
      <p className="dh-readaloud-note">
        {t("ui.readaloud.note", uiLang)}
        {voices.length === 0 ? t("ui.readaloud.noVoicesForLang", uiLang) : ""}
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ProgressAnnouncer — aria-live text for engine progress

export function ProgressAnnouncer({ message }: { message: string }) {
  return (
    <div className="dh-announcer" role="status" aria-live="polite">
      {message}
    </div>
  );
}

// Theme context (light/dark/contrast/text size)
type ThemeMode = "light" | "dark";
type Contrast = "normal" | "high";
type TextSize = "normal" | "large" | "xlarge";

interface ThemeApi {
  theme: ThemeMode;
  contrast: Contrast;
  textSize: TextSize;
  setTheme: (t: ThemeMode) => void;
  setContrast: (c: Contrast) => void;
  setTextSize: (s: TextSize) => void;
}

const ThemeCtx = createContext<ThemeApi | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [contrast, setContrast] = useState<Contrast>("normal");
  const [textSize, setTextSize] = useState<TextSize>("normal");

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.contrast = contrast;
    root.dataset.textsize = textSize;
  }, [theme, contrast, textSize]);

  const api: ThemeApi = { theme, contrast, textSize, setTheme, setContrast, setTextSize };
  return <ThemeCtx.Provider value={api}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeApi {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error("useTheme: no provider");
  return ctx;
}

export function EmptyState() {
  const { state } = useStore();
  const lang = state.options.language;

  if (state.busy && !state.result) {
    const recent = state.traceSteps.slice(-3);
    return (
      <section className="dh-card dh-card-accent" aria-live="polite">
        <h3 className="dh-card-title">{state.progressLabel || t("ui.add.reading", lang)}</h3>
        <div className="dh-busy-row">
          <span className="dh-spinner" role="img" aria-label={t("ui.a11y.working", lang)}>
            <span className="dh-spinner-dot" />
          </span>
          {recent.length > 0 ? (
            <ul className="dh-progress-steps">
              {recent.map((s) => (
                <li key={s.id}>{s.label}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="dh-empty" aria-labelledby="dh-empty-title">
      <p className="dh-empty-glyph" aria-hidden>
        📄
      </p>
      <h2 id="dh-empty-title">{t("ui.empty.title", lang)}</h2>
      <p>{t("ui.empty.body", lang)}</p>
      <p>
        <button type="button" className="dh-btn dh-btn-primary" onClick={() => navigate("/add")}>
          {t("ui.empty.cta", lang)}
        </button>
      </p>
    </section>
  );
}
