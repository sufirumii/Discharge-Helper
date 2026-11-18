/**
 * Engine contracts — the shared data model for the rule-based Discharge Agent
 * and every screen that renders its output. Plain data only: no framework
 * types, no DOM, so the engine stays unit-testable in Node.
 *
 * Determinism rule: same input text + same options ⇒ byte-identical
 * AnalysisResult. No timestamps inside the result except where a date is
 * derived from the papers or from options the caller supplies.
 */


// ────────────────────────────────────────────────────────────────────────────
// Spans — every fact points back into the NORMALISED text
// ────────────────────────────────────────────────────────────────────────────

export interface Span {
  start: number;
  end: number; // exclusive
}

// ────────────────────────────────────────────────────────────────────────────
// Frequency — FHIR-Timing-like, built from Indian and Latin sig grammar
// ────────────────────────────────────────────────────────────────────────────

export type DoseEvent = "MORN" | "NOON" | "EVE" | "NIGHT" | "WAKE";

export interface FreqTiming {
  /** Doses per period (for slot forms like 1-0-1 this is the number of non-zero slots). */
  frequency: number;
  period: number;
  periodUnit: "d" | "h" | "wk";
  /** Day anchors, in order. */
  when: DoseEvent[];
  /** Dose count per anchor, parallel to `when` (1-0-1 → [1, 0, 1]). */
  slotDoses?: number[];
  /** SOS / PRN — as needed, never counted. */
  prn: boolean;
  /** Fixed interval forms (Q6H etc.). */
  intervalHours?: number;
  /** "once a week on Sunday" */
  weeklyDay?: string;
  /** Sig as written in the papers. */
  raw: string;
  /** Set when the written form is on the error-prone list (QD, U, .5 mg). */
  errorProne?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Duration and course shapes
// ────────────────────────────────────────────────────────────────────────────

export type DurationKind = "fixed" | "continue" | "till-review" | "lifelong" | "missing";

export interface Duration {
  kind: DurationKind;
  /** Days when kind === "fixed". */
  days?: number;
  /** As written ("" when the papers say nothing about duration). */
  text: string;
}

export type Course = "start" | "change" | "stop" | "hold" | "taper" | null;

export interface TaperStep {
  doseText: string;
  days: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Lexicon resolution
// ────────────────────────────────────────────────────────────────────────────

export interface ResolvedIngredient {
  name: string;
  /** Per-ingredient strength when the brand's composition is known (FDC). */
  strength?: string;
}

export interface Resolution {
  kind: "brand" | "ingredient" | "unknown";
  brand?: string;
  ingredients: ResolvedIngredient[];
  fdc: boolean;
  /** Plain "commonly used for" glosses, one per ingredient. */
  usedFor: string[];
  drugClasses: string[];
  match: "exact" | "fuzzy" | "none";
  /** The lexicon spelling a fuzzy match landed on (shown back to the user). */
  fuzzyTo?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// The structured medicine line
// ────────────────────────────────────────────────────────────────────────────

export type MedStatus = "new" | "changed" | "stopped" | "same" | "unclear";
export type Confidence = "high" | "review";

export type FlagKind =
  | "lasa"
  | "duplicate-ingredient"
  | "error-prone-abbrev"
  | "high-alert"
  | "missing-frequency"
  | "missing-strength"
  | "missing-duration"
  | "missing-info"
  | "contradiction"
  | "fuzzy-name"
  | "unknown-name"
  | "hold"
  | "taper";

export interface MedFlag {
  kind: FlagKind;
  message: string;
  /** Second drug / other line / source URL, depending on kind. */
  detail?: string;
}

export interface StructuredMed {
  id: string;
  /** Verbatim line from the normalised text. */
  raw: string;
  span: Span;
  nameAsWritten: string;
  resolved: Resolution;
  /** Normalised form key: tab, cap, syp, inj, drops… */
  form?: string;
  formAsWritten?: string;
  /** As written, e.g. "500/125 mg", "625", "5 ml". */
  strength?: string;
  /** Dose as written, e.g. "1-0-1", "½", "2 puffs". */
  doseText?: string;
  /** Numeric per-slot dose when the grammar reduced it to one number. */
  dose?: number;
  frequency?: FreqTiming;
  frequencyText?: string;
  timing?: string;
  timingCode?: "AC" | "PC" | "WITH" | "EMPTY" | null;
  route?: string;
  duration: Duration;
  course: Course;
  taperSteps?: TaperStep[];
  /** Leftover words the grammar could not type. */
  note?: string;
  status: MedStatus;
  confidence: Confidence;
  flags: MedFlag[];
  /** Recomputed by the verifier: the span really does contain raw. */
  spanVerified: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Sections and coverage
// ────────────────────────────────────────────────────────────────────────────

export type SectionKind =
  | "header"
  | "diagnosis"
  | "hospital-course"
  | "meds-admission"
  | "meds-home"
  | "meds-discharge"
  | "allergies"
  | "advice"
  | "diet-activity"
  | "followup"
  | "pending-tests"
  | "warning-signs"
  | "other";

export type SectionStrategy = "headings" | "layout" | "classifier";

export interface Section {
  kind: SectionKind;
  start: number;
  end: number;
  headingText?: string;
  headingSpan?: Span;
  strategy: SectionStrategy;
}

export interface LineOutcome {
  line: string;
  span: Span;
  outcome: "captured" | "not-medicine" | "could-not-read";
  reason: string;
  medId?: string;
}

export interface CoverageReport {
  total: number;
  captured: number;
  notMedicine: number;
  unreadable: number;
  /** (captured + notMedicine) / total, 0–100. */
  coveragePct: number;
  lines: LineOutcome[];
}

// ────────────────────────────────────────────────────────────────────────────
// Agent trace
// ────────────────────────────────────────────────────────────────────────────

export type TraceStage = "perceive" | "plan" | "act" | "verify" | "reflect" | "escalate";

export interface TraceStep {
  id: string;
  stage: TraceStage;
  /** Tool that produced the step: normalise, sectioner, sig-reader, lexicon… */
  tool: string;
  /** One plain sentence for the trace screen. */
  label: string;
  detail?: string;
  span?: Span;
  confidence?: Confidence;
  reason?: string;
}

export interface AgentTrace {
  steps: TraceStep[];
  strategyNotes: string[];
  /** Reflect loop retries (next-strategy attempts). */
  retries: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Dates (day-first parsing)
// ────────────────────────────────────────────────────────────────────────────

export interface ParsedDate {
  /** YYYY-MM-DD in the user's calendar interpretation. */
  iso: string;
  text: string;
  /** True when day/month could be swapped — "please confirm". */
  ambiguous: boolean;
  note?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Non-medication extractions
// ────────────────────────────────────────────────────────────────────────────

export interface AllergyItem {
  text: string;
  span: Span;
}

export interface FollowupItem {
  text: string;
  span: Span;
  date?: ParsedDate;
  /** Review-after-N-days turned into a day count from discharge. */
  daysFromDischarge?: number;
  kind: "appointment" | "review" | "test";
}

export interface WarningItem {
  text: string;
  span: Span;
  severity: "call" | "er";
}

// ────────────────────────────────────────────────────────────────────────────
// Day plan, quantity, chemist sheet
// ────────────────────────────────────────────────────────────────────────────

export interface DoseSlot {
  /** "08:00" (editable anchor) or "when needed". */
  time: string;
  medId: string;
  medName: string;
  doseText: string;
  withFood?: boolean;
  prn?: boolean;
}

export interface TaperPlan {
  medId: string;
  medName: string;
  steps: { fromDay: number; toDay: number; doseText: string }[];
}

export interface HoldPlan {
  medId: string;
  medName: string;
  description: string;
}

export interface RefillInfo {
  medId: string;
  medName: string;
  /** ISO date to buy more, or null when no countable units exist. */
  refillDate: string | null;
  days: number;
  unitsToBuy: string;
  /** True when days came from the editable default, not the papers. */
  assumedDays: boolean;
}

export interface DayPlan {
  slots: DoseSlot[];
  tapers: TaperPlan[];
  holds: HoldPlan[];
  ambiguous: { medName: string; rawFrequency: string }[];
  refills: RefillInfo[];
}

export interface ChemistRow {
  medId: string;
  /** Ingredient(s) (salt) — "amoxicillin + clavulanic acid". */
  salt: string;
  brandAsWritten: string;
  strength: string;
  form: string;
  dose: string;
  frequency: string;
  days: string;
  unitsNeeded: string;
  notes: string;
  flags: string[];
}

export interface ChemistSheet {
  /** ISO date the sheet was prepared (analysis date). */
  date: string;
  dischargeDate?: string;
  rows: ChemistRow[];
  footer: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Questions and teach-back
// ────────────────────────────────────────────────────────────────────────────

export type QuestionReason =
  | "contradiction"
  | "unclear"
  | "look-alike"
  | "duplicate"
  | "missing-info"
  | "unreadable";

export interface QuestionItem {
  id: string;
  text: string;
  reason: QuestionReason;
}

export interface TeachBackOption {
  id: string;
  text: string;
}

export interface TeachBackItem {
  id: string;
  topicKey: string;
  question: string;
  options: TeachBackOption[];
  correctId: string;
  /** Re-explain text built from the same template (retry path). */
  explain: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Run options and the full result
// ────────────────────────────────────────────────────────────────────────────

export type Lang = "en" | "hi" | "te";

export interface BeforeMed {
  name: string;
  strength?: string;
  doseText?: string;
  frequencyText?: string;
  /** Where the line lives in the papers (absent for user-typed entries). */
  span?: Span;
}

export interface MealAnchors {
  morning: string;
  midday: string;
  evening: string;
  bedtime: string;
}

export const DEFAULT_ANCHORS: MealAnchors = {
  morning: "08:00",
  midday: "13:00",
  evening: "20:00",
  bedtime: "22:00",
};

export interface EngineOptions {
  /** Parsed from the papers when present; caller may supply one. */
  dischargeDate?: ParsedDate;
  before: BeforeMed[];
  language: Lang;
  anchors: MealAnchors;
  /** Editable assumption for "continue"/missing durations. */
  daysToBuyDefault: number;
}

export interface AnalysisResult {
  normalisedText: string;
  sections: Section[];
  medications: StructuredMed[];
  /** Before-list found in the papers themselves (admission/home sections). */
  beforeDetected: BeforeMed[];
  allergies: AllergyItem[];
  followups: FollowupItem[];
  warnings: WarningItem[];
  coverage: CoverageReport;
  trace: AgentTrace;
  plan: DayPlan;
  sheet: ChemistSheet;
  questions: QuestionItem[];
  teachBack: TeachBackItem[];
  /** One plain sentence per medicine, from the reviewed templates. */
  plainSentences: string[];
  /** The sentences joined, for the summary header. */
  plainSummary: string;
  /** Grade of the composed plain-language sentences (Flesch–Kincaid). */
  readingGrade: number;
}

export type DocKind = "paste" | "pdf-text" | "txt" | "photo";

/**
 * A single source document (the patient's own discharge paperwork).
 * Text-only after normalisation; photo bytes live only while the text
 * recogniser runs, never in storage.
 */
export interface SourceDoc {
  id: string;
  kind: DocKind;
  text?: string;
  label: string;
  createdAt: number;
}

/** A verbatim anchor back into the source text, verified by code. */
export interface Evidence {
  start: number;
  end: number;
  snippet: string;
  verified: boolean;
}
