/**
 * The app store — one context + reducer. Owns the working session: the
 * documents (editable text), the before-hospital medicine list, the engine
 * options (language, meal anchors, assumed days), the latest analysis result
 * and the live trace steps. Everything is persisted encrypted via
 * storage/session; nothing ever leaves the device.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import type { ReactNode } from "react";
import { analyse } from "@/engine/client";
import type { AnalysisResult, BeforeMed, EngineOptions, Lang, MealAnchors, TraceStep } from "@/engine/types";
import { DEFAULT_ANCHORS } from "@/engine/types";
import { loadSession, saveSession, type PersistedDoc } from "@/storage/idb";
import { sampleById } from "@/sample";
import { t } from "@/i18n";
import { navigate } from "./router";
import { stripMarkers } from "./lib";

// ────────────────────────────────────────────────────────────────────────────
// State shape

export interface UiDoc {
  id: string;
  kind: PersistedDoc["kind"];
  label: string;
  text: string;
}

export interface UiOptions {
  language: Lang;
  anchors: MealAnchors;
  daysToBuyDefault: number;
}

export interface ToastMsg {
  id: number;
  kind: "info" | "warn" | "error" | "success";
  text: string;
}

export interface AppState {
  booted: boolean;
  docs: UiDoc[];
  before: BeforeMed[];
  options: UiOptions;
  result: AnalysisResult | null;
  traceSteps: TraceStep[];
  busy: boolean;
  progressLabel: string;
  toasts: ToastMsg[];
  sessionRestored: boolean;
}

type Action =
  | { type: "booted" }
  | { type: "restore"; docs: UiDoc[]; before: BeforeMed[]; options: UiOptions }
  | { type: "docs"; docs: UiDoc[] }
  | { type: "docText"; id: string; text: string }
  | { type: "before"; before: BeforeMed[] }
  | { type: "options"; options: UiOptions }
  | { type: "result"; result: AnalysisResult | null }
  | { type: "traceReset" }
  | { type: "tracePush"; step: TraceStep }
  | { type: "busy"; busy: boolean; label?: string }
  | { type: "toast"; toast: ToastMsg | null };

const initial: AppState = {
  booted: false,
  docs: [],
  before: [],
  options: { language: "en", anchors: { ...DEFAULT_ANCHORS }, daysToBuyDefault: 14 },
  result: null,
  traceSteps: [],
  busy: false,
  progressLabel: "",
  toasts: [],
  sessionRestored: false,
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "booted":
      return { ...state, booted: true };
    case "restore":
      return { ...state, booted: true, sessionRestored: true, docs: action.docs, before: action.before, options: action.options };
    case "docs":
      return { ...state, docs: action.docs };
    case "docText":
      return {
        ...state,
        docs: state.docs.map((d) => (d.id === action.id ? { ...d, text: action.text } : d)),
      };
    case "before":
      return { ...state, before: action.before };
    case "options":
      return { ...state, options: action.options };
    case "result":
      return { ...state, result: action.result };
    case "traceReset":
      return { ...state, traceSteps: [] };
    case "tracePush":
      return { ...state, traceSteps: [...state.traceSteps.slice(-240), action.step] };
    case "busy":
      return { ...state, busy: action.busy, progressLabel: action.busy ? action.label ?? state.progressLabel : "" };
    case "toast":
      return {
        ...state,
        toasts: action.toast ? [...state.toasts.slice(-3), action.toast] : state.toasts.slice(1),
      };
    default:
      return state;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Context API

export interface StoreApi {
  state: AppState;
  lang: Lang;
  toast: (kind: ToastMsg["kind"], text: string) => void;
  setDocs: (docs: UiDoc[]) => void;
  /** Prepend a document: the newest text is the one the editor shows. */
  addDoc: (doc: UiDoc) => void;
  removeDoc: (id: string) => void;
  setDocText: (id: string, text: string) => void;
  setBefore: (before: BeforeMed[]) => void;
  setOptions: (patch: Partial<UiOptions>) => void;
  runAnalysis: (opts?: { options?: Partial<UiOptions>; navigateTo?: string | false }) => Promise<void>;
  loadSample: (id: string) => void;
  clearAll: () => void;
}

const StoreCtx = createContext<StoreApi | null>(null);

export function useStore(): StoreApi {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error("useStore: context missing");
  return ctx;
}

/** The UI language for leaf components; "en" when rendered without a provider. */
export function useLang(): Lang {
  return useContext(StoreCtx)?.lang ?? "en";
}

let toastSeq = 0;
let docSeq = 0;

function engineOptions(options: UiOptions, before: BeforeMed[]): EngineOptions {
  return {
    before,
    language: options.language,
    anchors: options.anchors,
    daysToBuyDefault: options.daysToBuyDefault,
  };
}

function joinedText(docs: UiDoc[]): string {
  return docs
    .map((d) => stripMarkers(d.text))
    .join("\n\n")
    .trim();
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const stateRef = useRef(state);
  stateRef.current = state;
  const bootedRef = useRef(false);

  // ── Boot: restore the encrypted session, then re-run the reading engine. ──
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    (async () => {
      try {
        const session = await loadSession();
        if (session && session.docs.length > 0) {
          const docs: UiDoc[] = session.docs.map((d) => ({
            id: d.id,
            kind: d.kind,
            label: d.label,
            text: d.text ?? "",
          }));
          const options: UiOptions = {
            language: session.language,
            anchors: session.anchors ?? { ...DEFAULT_ANCHORS },
            daysToBuyDefault: session.daysToBuyDefault ?? 14,
          };
          dispatch({ type: "restore", docs, before: session.before ?? [], options });
          if (joinedText(docs)) {
            await runAnalyse(docs, options, session.before ?? [], { navigateTo: false });
          }
          return;
        }
      } catch {
        /* a unreadable session is treated as absent */
      }
      dispatch({ type: "booted" });
    })();
    // runAnalyse below is referentially stable (its only dep, toast, is stable).
  }, []);

  const toast = useCallback((kind: ToastMsg["kind"], text: string) => {
    const id = (toastSeq += 1);
    dispatch({ type: "toast", toast: { id, kind, text } });
    setTimeout(() => dispatch({ type: "toast", toast: null }), 5200);
  }, []);

  // ── The shared analysis runner ─────────────────────────────────────────────
  const runAnalyse = useCallback(
    async (docs: UiDoc[], options: UiOptions, before: BeforeMed[], opts?: { navigateTo?: string | false }) => {
      const lang = options.language;
      const text = joinedText(docs);
      if (!text) {
        dispatch({ type: "busy", busy: false });
        return;
      }
      dispatch({ type: "traceReset" });
      dispatch({ type: "busy", busy: true, label: t("ui.add.reading", lang) });
      try {
        const result = await analyse(text, engineOptions(options, before), (step) => {
          dispatch({ type: "tracePush", step });
        });
        dispatch({ type: "result", result });
        // Adopt the papers' own before-list once, so the editor can show it.
        const s = stateRef.current;
        if (s.before.length === 0 && result.beforeDetected.length > 0) {
          dispatch({ type: "before", before: result.beforeDetected });
        }
        if (opts?.navigateTo !== false) navigate(opts?.navigateTo ?? "/changes");
      } catch (err) {
        dispatch({ type: "result", result: null });
        toast("error", err instanceof Error ? err.message : String(err));
      } finally {
        dispatch({ type: "busy", busy: false });
      }
    },
    [toast],
  );

  // ── Persistence (debounced ~800ms, encrypted) ─────────────────────────────
  useEffect(() => {
    if (!state.booted) return;
    const handle = setTimeout(() => {
      void saveSession({
        docs: state.docs.map((d) => ({ id: d.id, kind: d.kind, label: d.label, text: d.text })),
        before: state.before,
        language: state.options.language,
        anchors: state.options.anchors,
        daysToBuyDefault: state.options.daysToBuyDefault,
        savedAt: Date.now(),
      }).catch(() => {
        /* private-mode browsers may refuse IndexedDB; the session stays in memory */
      });
    }, 800);
    return () => clearTimeout(handle);
  }, [state.booted, state.docs, state.before, state.options]);

  const api: StoreApi = useMemo(() => {
    const setDocs = (docs: UiDoc[]) => dispatch({ type: "docs", docs });
    return {
      state,
      lang: state.options.language,
      toast,

      setDocs,

      addDoc: (doc) => {
        docSeq += 1;
        const withId = doc.id ? doc : { ...doc, id: `doc-${Date.now()}-${docSeq}` };
        dispatch({ type: "docs", docs: [withId, ...stateRef.current.docs.filter((d) => d.id !== withId.id)] });
      },

      removeDoc: (id) => dispatch({ type: "docs", docs: stateRef.current.docs.filter((d) => d.id !== id) }),

      setDocText: (id, text) => dispatch({ type: "docText", id, text }),

      setBefore: (before) => dispatch({ type: "before", before }),

      setOptions: (patch) => {
        const prev = stateRef.current.options;
        const next: UiOptions = {
          ...prev,
          ...patch,
          anchors: { ...prev.anchors, ...(patch.anchors ?? {}) },
        };
        dispatch({ type: "options", options: next });
        if (patch.language && patch.language !== prev.language) {
          const s = stateRef.current;
          if (joinedText(s.docs) && !s.busy) {
            void runAnalyse(s.docs, next, s.before, { navigateTo: false });
          }
        }
      },

      runAnalysis: async (opts) => {
        const s = stateRef.current;
        const options: UiOptions = { ...s.options, ...(opts?.options ?? {}) };
        if (opts?.options) dispatch({ type: "options", options });
        if (!joinedText(s.docs)) {
          toast("warn", t("ui.add.needText", options.language));
          return;
        }
        await runAnalyse(s.docs, options, s.before, { navigateTo: opts?.navigateTo });
      },

      loadSample: (id) => {
        const s = sampleById(id);
        if (!s) return;
        dispatch({
          type: "docs",
          docs: [{ id: `sample-${s.id}`, kind: "paste", label: s.label, text: s.text }],
        });
        dispatch({ type: "result", result: null });
        dispatch({ type: "traceReset" });
        toast("info", t("ui.add.samples.loaded", stateRef.current.options.language, { label: s.label }));
      },

      clearAll: () => {
        dispatch({ type: "docs", docs: [] });
        dispatch({ type: "before", before: [] });
        dispatch({ type: "result", result: null });
        dispatch({ type: "traceReset" });
      },
    };
  }, [state, toast, runAnalyse]);

  return <StoreCtx.Provider value={api}>{children}</StoreCtx.Provider>;
}
