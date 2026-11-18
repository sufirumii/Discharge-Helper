/**
 * eval — measures the reading engine against the hand-written expected
 * results in eval/corpus.json and writes eval/report.md.
 *
 * The corpus is synthetic and authored by the project; it is NOT clinical
 * validation. Thresholds fail the run when the engine regresses:
 *   coverage ≥ 92%, medicine-name recall ≥ 0.90, precision ≥ 0.95,
 *   field exact-match ≥ 0.85 (strength / frequency / duration / course).
 *
 * A noise suite re-runs every case with deterministic noise (case changes,
 * extra whitespace, OCR-style character swaps) and reports how scores move.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent } from "../src/engine/agent";
import { normaliseText } from "../src/engine/normalise";
import { DEFAULT_ANCHORS } from "../src/engine/types";
import type { AnalysisResult, StructuredMed } from "../src/engine/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const corpusFile = join(root, "eval", "corpus.json");

interface ExpectedMed {
  name: string;
  strength?: string;
  frequencyText?: string;
  durationDays?: number | null;
  durationKind?: string;
  course?: string;
}

interface Expected {
  medications: ExpectedMed[];
  followups: number;
  warnings: number;
}

const OPTS = {
  before: [],
  language: "en" as const,
  anchors: DEFAULT_ANCHORS,
  daysToBuyDefault: 30,
};

// ── noise suite (deterministic) ─────────────────────────────────────────────

function noiseUpper(text: string): string {
  // Uppercase every third word, keep the rest — case stress.
  return text
    .split("\n")
    .map((line) => line.split(" ").map((w, i) => (i % 3 === 0 ? w.toUpperCase() : w)).join(" "))
    .join("\n");
}

function noiseWhitespace(text: string): string {
  return text.replace(/ /g, "   ").replace(/\n/g, "\n\n");
}

function noiseOcr(text: string): string {
  // Swap visually confusable characters inside alphanumeric runs.
  return text.replace(/[a-zA-Z0-9]+/g, (run) => {
    if (run.length < 4) return run;
    const chars = run.split("");
    const i = Math.floor(run.length / 2);
    const c = chars[i];
    if (c === "l") chars[i] = "1";
    else if (c === "O") chars[i] = "0";
    else if (c === "e") chars[i] = "c";
    else if (c === "n") chars[i] = "r";
    else if (c === "g") chars[i] = "q";
    else return run;
    return chars.join("");
  });
}

const NOISES: { name: string; apply: (t: string) => string }[] = [
  { name: "case changes", apply: noiseUpper },
  { name: "extra whitespace", apply: noiseWhitespace },
  { name: "OCR-style swaps", apply: noiseOcr },
];

// ── scoring ─────────────────────────────────────────────────────────────────

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function scoreCase(expected: Expected, result: AnalysisResult) {
  const found: StructuredMed[] = result.medications.filter((m) => m.span.start >= 0 && !m.id.startsWith("med-before-"));
  const foundByName = new Map<string, StructuredMed>();
  for (const m of found) {
    if (!foundByName.has(norm(m.nameAsWritten))) foundByName.set(norm(m.nameAsWritten), m);
  }

  let nameHits = 0;
  let strengthTotal = 0;
  let strengthExact = 0;
  let freqTotal = 0;
  let freqExact = 0;
  let durationTotal = 0;
  let durationExact = 0;
  let courseTotal = 0;
  let courseExact = 0;
  const missed: string[] = [];

  for (const exp of expected.medications) {
    const key = norm(exp.name);
    let hit = foundByName.get(key);
    if (!hit) {
      // The parser may keep a qualifier ("Glycomet-GP2") we did not write.
      for (const [k, m] of foundByName) {
        if (k.startsWith(key) || key.startsWith(k)) {
          hit = m;
          break;
        }
      }
    }
    if (!hit) {
      missed.push(exp.name);
      continue;
    }
    nameHits += 1;
    if (exp.strength !== undefined) {
      strengthTotal += 1;
      if (norm(hit.strength ?? "") === norm(exp.strength)) strengthExact += 1;
    }
    if (exp.frequencyText !== undefined) {
      freqTotal += 1;
      if (norm(hit.frequencyText ?? "").replace(/\s/g, "") === norm(exp.frequencyText).replace(/\s/g, "")) {
        freqExact += 1;
      }
    }
    if (exp.durationDays !== undefined || exp.durationKind !== undefined) {
      durationTotal += 1;
      const daysOk =
        exp.durationDays === null
          ? hit.duration.kind !== "fixed"
          : exp.durationDays === undefined
            ? true
            : hit.duration.days === exp.durationDays;
      const kindOk = exp.durationKind === undefined || hit.duration.kind === exp.durationKind;
      if (daysOk && kindOk) durationExact += 1;
    }
    if (exp.course !== undefined) {
      courseTotal += 1;
      if (hit.course === exp.course) courseExact += 1;
    }
  }

  const precisionDenom = found.length;
  const precision = precisionDenom === 0 ? 0 : nameHits / precisionDenom;
  const recall = expected.medications.length === 0 ? 1 : nameHits / expected.medications.length;

  return {
    precision,
    recall,
    missed,
    extra: found.length - nameHits,
    coverage: result.coverage.coveragePct,
    strength: strengthTotal === 0 ? 1 : strengthExact / strengthTotal,
    freq: freqTotal === 0 ? 1 : freqExact / freqTotal,
    duration: durationTotal === 0 ? 1 : durationExact / durationTotal,
    course: courseTotal === 0 ? 1 : courseExact / courseTotal,
    followupsOk: result.followups.length === expected.followups,
    warningsOk: result.warnings.length === expected.warnings,
  };
}

function pct(x: number): string {
  return `${Math.round(x * 1000) / 10}%`;
}

// ── run ─────────────────────────────────────────────────────────────────────

const cases = JSON.parse(readFileSync(corpusFile, "utf-8")) as { id: string; text: string; expected: Expected }[];
if (cases.length < 12) {
  console.error(`eval: expected at least 12 corpus cases, found ${cases.length}`);
  process.exit(1);
}

interface Row {
  case: string;
  precision: number;
  recall: number;
  coverage: number;
  strength: number;
  freq: number;
  duration: number;
  course: number;
  followupsOk: boolean;
  warningsOk: boolean;
  missed: string[];
}

const cleanRows: Row[] = [];
const noiseRows: { noise: string; recall: number; precision: number; coverage: number }[] = [];

for (const { id, text, expected } of cases) {
  const result = runAgent(normaliseText(text).text, OPTS);
  const s = scoreCase(expected, result);
  cleanRows.push({ case: id, ...s });

  for (const noise of NOISES) {
    const noisy = noise.apply(text);
    const nResult = runAgent(normaliseText(noisy).text, OPTS);
    const ns = scoreCase(expected, nResult);
    noiseRows.push({ noise: noise.name, recall: ns.recall, precision: ns.precision, coverage: ns.coverage });
  }
}

const avg = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const overall = {
  precision: avg(cleanRows.map((r) => r.precision)),
  recall: avg(cleanRows.map((r) => r.recall)),
  coverage: avg(cleanRows.map((r) => r.coverage)),
  strength: avg(cleanRows.map((r) => r.strength)),
  freq: avg(cleanRows.map((r) => r.freq)),
  duration: avg(cleanRows.map((r) => r.duration)),
  course: avg(cleanRows.map((r) => r.course)),
  followups: cleanRows.filter((r) => r.followupsOk).length,
  warnings: cleanRows.filter((r) => r.warningsOk).length,
};

const noiseOverall = NOISES.map((n) => {
  const rows = noiseRows.filter((r) => r.noise === n.name);
  return {
    noise: n.name,
    recall: avg(rows.map((r) => r.recall)),
    precision: avg(rows.map((r) => r.precision)),
    coverage: avg(rows.map((r) => r.coverage)),
  };
});

// Thresholds.
const THRESHOLDS = { coverage: 0.92, recall: 0.9, precision: 0.95, strength: 0.85, freq: 0.85, duration: 0.85, course: 0.85 };
const failures: string[] = [];
if (overall.coverage / 100 < THRESHOLDS.coverage) failures.push(`coverage ${pct(overall.coverage / 100)} < ${pct(THRESHOLDS.coverage)}`);
if (overall.recall < THRESHOLDS.recall) failures.push(`name recall ${pct(overall.recall)} < ${pct(THRESHOLDS.recall)}`);
if (overall.precision < THRESHOLDS.precision) failures.push(`name precision ${pct(overall.precision)} < ${pct(THRESHOLDS.precision)}`);
if (overall.strength < THRESHOLDS.strength) failures.push(`strength exact-match ${pct(overall.strength)} < ${pct(THRESHOLDS.strength)}`);
if (overall.freq < THRESHOLDS.freq) failures.push(`frequency exact-match ${pct(overall.freq)} < ${pct(THRESHOLDS.freq)}`);
if (overall.duration < THRESHOLDS.duration) failures.push(`duration exact-match ${pct(overall.duration)} < ${pct(THRESHOLDS.duration)}`);
if (overall.course < THRESHOLDS.course) failures.push(`course exact-match ${pct(overall.course)} < ${pct(THRESHOLDS.course)}`);

// Report.
const lines: string[] = [];
lines.push("# Reading-engine evaluation");
lines.push("");
lines.push("Corpus: 12 synthetic discharge summaries written by the project, each with a hand-written expected result. This is a regression measure, not clinical validation.");
lines.push("");
lines.push("## Clean corpus");
lines.push("");
lines.push("| case | name recall | name precision | coverage | strength | frequency | duration | course | follow-ups | warnings |");
lines.push("|---|---|---|---|---|---|---|---|---|---|");
for (const r of cleanRows) {
  lines.push(
    `| ${r.case} | ${pct(r.recall)} | ${pct(r.precision)} | ${Math.round(r.coverage)}% | ${pct(r.strength)} | ${pct(r.freq)} | ${pct(r.duration)} | ${pct(r.course)} | ${r.followupsOk ? "ok" : "differs"} | ${r.warningsOk ? "ok" : "differs"} |`,
  );
}
lines.push("");
lines.push(`**Overall (clean):** name recall ${pct(overall.recall)}, name precision ${pct(overall.precision)}, coverage ${Math.round(overall.coverage)}%, strength ${pct(overall.strength)}, frequency ${pct(overall.freq)}, duration ${pct(overall.duration)}, course ${pct(overall.course)}. Follow-up counts matched in ${overall.followups}/12 cases, warning counts in ${overall.warnings}/12.`);
lines.push("");
lines.push("## Noise suite (deterministic distortions of the same corpus)");
lines.push("");
lines.push("| noise | name recall | name precision | coverage |");
lines.push("|---|---|---|---|");
for (const n of noiseOverall) {
  lines.push(`| ${n.noise} | ${pct(n.recall)} | ${pct(n.precision)} | ${Math.round(n.coverage)}% |`);
}
lines.push("");
lines.push("## Missed medicines (clean corpus)");
lines.push("");
const missedAll = cleanRows.flatMap((r) => r.missed.map((m) => `${r.case}: ${m}`));
lines.push(missedAll.length === 0 ? "None." : missedAll.map((m) => `- ${m}`).join("\n"));
lines.push("");
lines.push("## Thresholds");
lines.push("");
lines.push(`coverage ≥ ${pct(THRESHOLDS.coverage)} — got ${pct(overall.coverage / 100)}`);
lines.push(`name recall ≥ ${pct(THRESHOLDS.recall)} — got ${pct(overall.recall)}`);
lines.push(`name precision ≥ ${pct(THRESHOLDS.precision)} — got ${pct(overall.precision)}`);
lines.push(`strength/frequency/duration/course exact-match ≥ ${pct(THRESHOLDS.strength)} — got ${pct(overall.strength)} / ${pct(overall.freq)} / ${pct(overall.duration)} / ${pct(overall.course)}`);
lines.push("");
if (failures.length > 0) {
  lines.push("**FAILED THRESHOLDS**");
  lines.push("");
  lines.push(failures.map((f) => `- ${f}`).join("\n"));
} else {
  lines.push("All thresholds pass.");
}
lines.push("");

mkdirSync(join(root, "eval"), { recursive: true });
writeFileSync(join(root, "eval", "report.md"), lines.join("\n") + "\n", "utf-8");

console.log(lines.join("\n"));
if (failures.length > 0) {
  console.error("\neval: FAILED — fix the engine (or correct the expected files if the expectation itself was wrong); do not lower the thresholds.");
  process.exit(1);
}
console.log("\neval: all thresholds pass.");
