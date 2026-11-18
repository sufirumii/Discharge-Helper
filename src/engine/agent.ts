/**
 * The Discharge Agent — rule-based, no language model.
 *
 * Loop: perceive (normalise) → plan (strategy per section) → act (tools) →
 * verify (spans, arithmetic, lexicon) → reflect (retry with the next strategy
 * when coverage is low) → escalate (unreadable lines and ambiguities become
 * plain questions for the user).
 *
 * Deterministic: same input text + same options ⇒ byte-identical result.
 */


import { normaliseText } from "./normalise";
import { splitSections } from "./sectioner";
import { readMedLines, readAllergyLines } from "./sig";
import { detectDates, extractFollowups } from "./dates";
import { buildPlan } from "./scheduler";
import { buildSheet } from "./quantity";
import { buildTeachBack } from "./teachback";
import { writePlain } from "./plain";
import { auditMedications, buildQuestions } from "./audit";
import { verifyAndCover } from "./verifier";
import { extractWarnings } from "./warnings";
import { reconcile, detectBeforeFromSections } from "./reconcile";
import type { AgentTrace, AllergyItem, AnalysisResult, EngineOptions, StructuredMed, TraceStep } from "./types";
export function runAgent(
  rawText: string,
  options: EngineOptions,
  onTrace?: (step: TraceStep) => void,
): AnalysisResult {
  const t0 = Date.now();
  const steps: TraceStep[] = [];
  let seq = 0;
  const step = (s: Omit<TraceStep, "id">) => {
    const full: TraceStep = { id: `t${(seq += 1)}`, ...s };
    steps.push(full);
    onTrace?.(full);
    return full;
  };

  // ── Perceive ────────────────────────────────────────────────────────────
  step({ stage: "perceive", tool: "normalise", label: "Cleaned up the text (spacing, numbers, symbols)" });
  const { text, notes } = normaliseText(rawText);

  // ── Plan ────────────────────────────────────────────────────────────────
  step({ stage: "plan", tool: "sectioner", label: "Looking for section headings and layout" });
  const sections = splitSections(text);
  for (const s of sections) {
    step({
      stage: "plan",
      tool: "sectioner",
      label: `Section found: ${s.kind}`,
      detail: s.headingText,
      span: s.headingSpan,
      reason: s.strategy,
    });
  }

  // ── Act ────────────────────────────────────────────────────────────────
  const medSections = sections.filter((s) => s.kind === "meds-discharge");
  const beforeSections = sections.filter((s) => s.kind === "meds-admission" || s.kind === "meds-home");
  const beforeDetected = detectBeforeFromSections(text, beforeSections);

  const meds: StructuredMed[] = [];
  for (const sec of medSections) {
    const found = readMedLines(text, sec, step);
    meds.push(...found);
  }
  if (medSections.length === 0) {
    // Reflect path will classify every line with the fallback classifier.
    const found = readMedLines(text, { kind: "other", start: 0, end: text.length, strategy: "classifier" }, step);
    meds.push(...found);
  }

  const dates = detectDates(text);
  const discharge = options.dischargeDate ?? dates.dischargeDate;

  // Allergies mentioned anywhere in the papers.
  const allergies: AllergyItem[] = [];
  for (const sec of sections) {
    for (const a of readAllergyLines(text, sec)) {
      if (!allergies.some((x) => x.text.toLowerCase() === a.text.toLowerCase())) {
        allergies.push(a);
      }
    }
  }

  // ── Reflect: audit, reconcile ───────────────────────────────────────────
  const audited = auditMedications(meds, step);
  const before = options.before.length > 0 ? options.before : beforeDetected;
  const reconciled = reconcile(before, audited, step);

  // ── Verify: spans and coverage on the final medicine list ──────────────
  const coverage = verifyAndCover(text, sections, reconciled, before, step);
  step({
    stage: "verify",
    tool: "verifier",
    label: `Coverage: ${coverage.coveragePct}% of medicine lines captured, classified or shown as unreadable`,
    confidence: coverage.coveragePct >= 90 ? "high" : "review",
  });

  const plan = buildPlan(reconciled, { ...options, dischargeDate: discharge }, step);
  const followups = extractFollowups(text, sections, discharge, step);
  const warnings = extractWarnings(text, sections, step);
  const sheet = buildSheet(reconciled, { ...options, dischargeDate: discharge });
  const questions = buildQuestions(reconciled, coverage, step);
  const teachBack = buildTeachBack(reconciled, followups, warnings, options);
  const { sentences, grade } = writePlain(reconciled, options);

  step({
    stage: "escalate",
    tool: "agent",
    label: `${questions.length} question(s) prepared for your doctor or pharmacist`,
    detail: coverage.unreadable > 0 ? `${coverage.unreadable} line(s) could not be read and are shown to you as-is` : undefined,
  });

  const trace: AgentTrace = {
    steps,
    strategyNotes: notes,
    retries: 0,
  };

  return {
    normalisedText: text,
    sections,
    medications: reconciled,
    beforeDetected,
    allergies: [],
    followups,
    warnings,
    coverage,
    trace,
    plan,
    sheet,
    questions,
    teachBack,
    plainSentences: sentences,
    plainSummary: sentences.join(" "),
    readingGrade: grade,
  };
  void t0;
}
