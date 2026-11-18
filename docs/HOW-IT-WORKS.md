# How it works

This document explains the reading engine for an engineer. The engine is the
**Discharge Agent** — rule-based, no language model. It is plain TypeScript
(`src/engine/`), runs entirely in the browser (in a web worker on the main path,
in-thread for tests and the evaluation), and is deterministic: the same input
text plus the same options gives a byte-identical `AnalysisResult`. A test
(`tests/engine/determinism.test.ts`) asserts this.

Two rules shape every design decision:

1. **Spans stay honest.** Every extracted fact carries a `Span` (`start`, `end`)
   pointing into the normalised text — the text the user saw and confirmed in
   the editor. A fact that cannot be traced back to a sentence is not shown as
   a fact.
2. **Never guess.** Anything the grammar cannot type is either kept as a note or
   surfaced to the user as "could not read this line" and turned into a
   question.

## The agent loop

`runAgent` in `src/engine/agent.ts` runs one pass:

```
perceive → plan → act → verify → reflect → escalate
```

- **Perceive** — `normaliseText` cleans the raw text. Cleaning is strictly 1:1
  character substitution, so every offset in the cleaned text is the same
  offset in the text the user confirmed.
- **Plan** — `splitSections` splits the text into sections and records the
  strategy used for each (`headings`, `layout` or `classifier`).
- **Act** — `readMedLines` (the sig reader) reads the medicine lines from the
  discharge sections, `detectDates` finds the dates, `readAllergyLines` scans
  every section for allergies. When no discharge section was found, the reflect
  path re-reads the whole text with the fallback line classifier.
- **Reflect** — `auditMedications` runs the safety checks and `reconcile`
  compares the before list with the discharge list. Low coverage triggers the
  next strategy rather than silence.
- **Verify** — `verifyAndCover` recomputes every span and builds the coverage
  report: every line is `captured`, `not-medicine` (with a reason) or
  `could-not-read`.
- **Escalate** — `buildQuestions` turns contradictions, missing details,
  look-alikes, duplicates and unreadable lines into plain questions.

Every step is recorded as a `TraceStep` (`stage`, `tool`, `label`, optional
`detail`, `span`, `confidence`, `reason`) and shown, in order, on the
**How I read it** screen. The user sees exactly what the engine did.

## The tools

### `normalise.ts` — the normaliser

Every transformation is a one-to-one character replacement so string length
never changes:

- NFKC compatibility per character (`ﬁ` → `fi`), applied only when the result is
  a single character.
- Script digits → ASCII: Devanagari, Telugu, Gujarati, Gurmukhi, Bengali,
  full-width and Arabic-Indic digits all map 1:1.
- Punctuation look-alikes → ASCII: every hyphen variant (`–`, `—`, `‑`, `−`…)
  becomes `-` (this matters for `1-0-1`), full-width `＋` → `+`, curly quotes →
  straight, narrow spaces → space.
- OCR noise repair **inside numbers only**: `O/o` → `0`, `l/I` → `1`, `S` → `5`,
  `B` → `8`, and only when the character sits between digits. A medicine name is
  never altered this way.

Anything that would change string length (rewriting bullets, collapsing
whitespace) is deliberately not done here; the parsers work line-by-line and
skip separators themselves. The normaliser reports what it did as strategy notes
in the trace (for example, "Converted 2 Indian-script digit(s) to English
numerals").

### `sectioner.ts` — the sectioner

Splits the text into `Section` objects (`kind`, `start`, `end`, `strategy`)
using, in order of preference:

1. **Heading dictionaries** — English plus common Indian variants, matched on
   the lowercased, de-numbered line (for example `DISCHARGE MEDICATIONS:`,
   `Rx`, `Treatment advised`, `Warning signs`, `Follow up`). Patterns have
   priorities; `meds-discharge` beats `meds-admission` when both match.
2. **Layout cues** — a short line, ending with `:`, ALL CAPS or numbered is
   treated as a heading candidate.
3. **Classifier fallback** — when no headings are found, `classifyLine`
   classifies every line by content and the whole text is read line-by-line.

Section kinds include `meds-admission`, `meds-home`, `meds-discharge`,
`allergies`, `diagnosis`, `hospital-course`, `advice`, `diet-activity`,
`followup`, `pending-tests` and `warning-signs`.

### `sig.ts` — the sig grammar

A real grammar, not a pile of regexes. One line is tokenised into **typed
tokens** (form, name, strength, dose, frequency, timing, duration, route,
course, note), then the tokens are reduced into a `StructuredMed`. Untyped
leftovers become the `note`; when too much is missing the line is reported as
could-not-read.

Indian forms lead: `Tab.`/`Cap.`/`Syp.` prefixes, `1-0-1` (with `+` and `½`
variants), `x 5 days`. `OD` is resolved by context: an eye route or eye drops
means "right eye"; otherwise "once daily". `SR/ER/XR/XL` after a name stay part
of the name.

The frequency grammar normalises everything to a `FreqTiming` structure —
FHIR-Timing-like (`frequency`, `period`, `periodUnit`, `when[]`,
`slotDoses[]`, `prn`, `intervalHours`, `weeklyDay`, `raw`, `errorProne`):

| as written | read as | result |
|---|---|---|
| `OD`, `once daily`, `daily` | once a day | `frequency: 1`, `period: 1 d`, `when: [MORN]` |
| `BD`, `BID`, `twice daily` | twice a day | `frequency: 2`, `when: [MORN, EVE]` |
| `TDS`, `TID` | three times a day | `frequency: 3`, `when: [MORN, NOON, EVE]` |
| `QID`, `QDS` | four times a day | `frequency: 4`, `when: [MORN, NOON, EVE, NIGHT]` |
| `HS`, `QHS`, `nocte`, `at bedtime` | at bedtime | `frequency: 1`, `when: [NIGHT]` |
| `OM` | every morning | `frequency: 1`, `when: [MORN]` |
| `ON` | every night | `frequency: 1`, `when: [NIGHT]` |
| `SOS`, `PRN`, `as needed` | as needed | `prn: true` — never counted |
| `STAT` | immediately | first dose anchored to the morning slot |
| `QOD`, `alternate days` | every other day | `frequency: 1`, `period: 2 d` |
| `Q4H`–`Q12H`, `every 6 hours` | fixed interval | `intervalHours: N`, `frequency: 24/N` |
| `1-0-1`, `1+0+1`, `½-0-½`, `1-0-0-1` | slot form | `when` + parallel `slotDoses` (2 slots = morning+night, 3 = morning+midday+night, 4 = morning+midday+evening+night) |
| `once a week on Sunday` | weekly | `period: 1 wk`, `weeklyDay: sunday` |

Error-prone written forms are detected, not silently accepted: `QD` carries an
`errorProne` note ("easily misread as QID or QOD — ask to have it rewritten").

### `lexicon.ts` — the lexicon resolver

Maps a name candidate (form words, strengths and sig already stripped) to
ingredient(s), form, drug class and a plain "commonly used for" gloss. Data
comes from `data/lexicon.json`, generated by `scripts/build-lexicon.mjs` from
`data/sources/*.csv` with provenance on every row (259 ingredients, 298 brands,
12 look-alike pairs, 6 error-prone abbreviations, 14 high-alert classes — see
[DATA-SOURCES.md](DATA-SOURCES.md)).

Matching is deterministic and layered:

1. Exact ingredient.
2. Exact brand.
3. Qualifier trimming: `Ecosprin AV` → `Ecosprin`, `Telma H` → `Telma`.
4. Bounded fuzzy match, only as a last resort: edit distance ≤ 1 for names of
   six characters or fewer, ≤ 2 for longer names, plus a small
   phonetic-confusion table. A fuzzy candidate must share the first letter and
   be at least four characters long (OCR slips rarely change a leading letter,
   and this stops words like "contact" drifting onto brand names).

A fuzzy match that lands on a look-alike pair member is **never auto-accepted**
— it comes back as unknown and becomes a question. Fuzzy resolutions are shown
back to the user ("spelling unclear (read as …)"). `enrichStrengths` then maps
the strength as written (`625`, `500/125`) to per-ingredient strengths for
combination brands.

### `reconcile.ts` — the reconciler

Compares the before list (admission/home medicines found in the papers, or the
user's own typed list) with the discharge list. Matching is by ingredient
first, then by brand, with a numeric-tolerant strength comparison (`10` and
`10 mg` are the same). Each medicine is labelled `new`, `changed`, `stopped`,
`same` or `unclear`; a changed item shows the exact before and after text.
Never guesses.

### `scheduler.ts` — the scheduler

Turns `FreqTiming` into a daily timetable (`DoseSlot` list) against editable
meal/sleep anchors (defaults 08:00, 13:00, 20:00, 22:00). `1-0-1` maps to
morning and night. Tapers become dated steps (`TaperPlan`), holds become
`HoldPlan` entries ("hold till cardiology review"), and ambiguous frequencies
are never guessed — they go to the questions.

### `quantity.ts` — the quantity calculator

Units per day × days = units to buy, with explicit rules:

- **PRN/SOS:** no count — "keep a small strip, use only if needed".
- **Non-countable forms** (syrup, suspension, injection, inhaler, rotacap,
  respule, nebuliser, ointment, cream, gel, drops, spray, sachet, powder,
  suppository, patch): no unit count — "ask the chemist for the pack that
  covers N days". A millilitre dose counts as a liquid whatever the line
  called it.
- **Assumed days are labelled:** "continue", "lifelong" or a missing duration
  falls back to the editable days-to-buy default (14 in the UI, 30 in the
  evaluation), and "till review" assumes 14 days — always marked as an
  assumption in the refill table.
- **Refill date = discharge date + days − 3** (a three-day buffer), floored at
  the discharge date.
- **Taper courses** sum their dated steps.
- Pack sizes are never claimed; the chemist can work strips out from the total
  count.

### `audit.ts` — the safety auditor

Deterministic checks only, in this order:

1. Look-alike / sound-alike pairs from the lexicon (FDA and ISMP lists, source
   URL on every pair), matched against both the name as written and the
   resolved ingredient names — so a brand is flagged through its ingredient
   (`Glycomet` → `metformin`, half of the metFORMIN/metronidazole pair). A
   bounded near-prefix rule also catches names that share their first five
   characters with a pair member.
2. Duplicate ingredient across brands or combinations (two paracetamol
   medicines under different brand names).
3. ISMP error-prone abbreviations (`QD`, `U`, `IU`, trailing zero `1.0 mg`, no
   leading zero `.5 mg`, `MSO4`) — each with "ask to have this rewritten".
4. High-alert medicines get a "double-check the dose with the pharmacist" note.
5. Missing pieces: no frequency, no strength, no duration.
6. Contradictions: the same ingredient started and stopped, or two different
   doses on one line.

No interaction checking, no dose-range checking — those need a knowledge
service, not a rule set, and they are stated as limits.

### `verifier.ts` — the verifier

For every extracted medicine the verifier recomputes its span and confirms the
recorded line exists in the confirmed text (`spanVerified` on `StructuredMed`).
Nothing is dropped on a failed check; confidence is only downgraded.

The coverage report then guarantees that every non-empty line inside the
medicine sections is exactly one of:

- `captured` — read as a medicine line;
- `not-medicine` — with a reason ("a heading", "a dose label line"…);
- `could-not-read` — shown to the user as-is.

`coveragePct` = (captured + not-medicine) / total lines. The evaluation
threshold is 92%; the corpus currently sits at 100% clean.

### `warnings.ts` — the warning-sign extractor

Lines from the papers only. Patterns split them into `er` severity ("go to the
emergency department immediately", "come to hospital now") and `call` severity
("call your doctor", "inform the ward"). Generic safety lines that are not from
the papers are labelled as general guidance by the UI, never mixed in.

### The follow-up extractor (in `dates.ts`)

Appointments ("review after 7 days", "Cardiology OPD on 16/12/2026"), pending
tests and lab results, each with a day-first parsed date and a day count from
discharge. All exportable as calendar events (`src/domain/ics.ts`).

### `plain.ts` — the plain-language writer

Templates, not generation. Every patient-facing sentence is composed from the
reviewed phrase tables (`data/phrases.json`, with `en`, `hi` and `te`
tables); drug names, strengths and numbers are inserted as variables
and stay exactly as written. The reading grade of the composed sentences is
measured (`src/domain/readingLevel.ts`, Flesch–Kincaid) and reported, and the
test suite fails if any template exceeds grade 8.

### `teachback.ts` — the teach-back builder

Multiple-choice questions computed from the structured data ("How many days
should you take Hydroxyzine?"). The correct answer is computed from the papers;
distractors come from the patient's own other medicines (a different duration,
a different medicine). A wrong answer re-explains from the same template. No
free-text grading, and the option order is deterministic.

### The chemist sheet builder (in `quantity.ts`)

One page the patient hands over or shows: `salt`, `brandAsWritten`,
`strength`, `form`, `dose`, `frequency`, `days`, `unitsNeeded`, `notes` and
`flags`. Stopped medicines are excluded. Patient identity stays off the sheet
unless the user opts in (the share layer owns that). No pricing, no inventory.

## A line, traced end to end

Raw line, as it appears in the papers:

```
1. Tab. Glycomet 500 mg 1-0-1 after food x 5 days
```

1. **Perceive.** The normaliser leaves this line untouched (no script digits, no
   OCR noise) but its 1:1 guarantee means the line's span — characters 141–190
   of the confirmed text — is valid in both worlds.
2. **Plan.** The line sits under `DISCHARGE MEDICATIONS:`, so the sectioner
   marks the section `meds-discharge` with strategy `headings`.
3. **Act.** The sig reader tokenises and reduces:
   - form: `Tab.` → `tab`
   - name: `Glycomet`
   - strength: `500 mg`
   - dose: `1-0-1` → slot form, `when: [MORN, NOON, NIGHT]`,
     `slotDoses: [1, 0, 1]`, `frequency: 2` per day
   - timing: `after food` → `timingCode: "PC"`
   - duration: `x 5 days` → `{ kind: "fixed", days: 5 }`
4. **Lexicon.** `Glycomet` is an exact brand match → one ingredient,
   `metformin`; strength enrichment keys `500` to `500 mg` per ingredient; class
   `biguanide antidiabetic`; used for: "lowers blood sugar".
5. **Reflect (audit).** `metformin` is half of the metFORMIN/metronidazole
   look-alike pair (ISMP List of Confused Drug Names), so the line carries a
   `lasa` flag.
6. **Reflect (reconcile).** No before list was found, so the medicine is
   labelled `new`, confidence `high`.
7. **Verify.** The span is recomputed: `text.slice(141, 190)` is the raw line,
   so `spanVerified: true` and the line outcome is `captured`.
8. **Plan (scheduler).** Two dose slots against the anchors: morning 08:00 and
   night 22:00 (the midday slot has dose 0).
9. **Quantity.** 2 tablets a day × 5 days = **10 tablets**. Refill date =
   discharge date `2026-11-09` (read day-first from the papers) + 5 days − 3 =
   **2026-11-11**. Shown in the refill table on My day, with the refill dates
   and unit counts for every medicine.
10. **Chemist sheet row**, exactly as built:

| field | value |
|---|---|
| salt | `metformin 500 mg` |
| brand as written | `Glycomet` |
| strength | `500 mg` |
| form | `tablet` |
| dose | `1-0-1` |
| frequency | `1-0-1` |
| days | `5 days` |
| units needed | countable tablets carry their count in the refill table (10 tablet(s), buy by 2026-11-11); the sheet's units column is filled for as-needed medicines ("keep a small strip, use only if needed") and non-countable forms ("ask the chemist for the pack that covers 5 days") |
| notes | `after food` |
| flags | `look-alike name — double-check` |

## Coverage and escalation, traced

Suppose the same papers also contain this line:

```
2. Rxcvf qzxv 8&&2 ???
```

The sig grammar cannot type it. It is not silently dropped:

1. The verifier's coverage walk marks it `could-not-read`, reason: "the reading
   rules did not understand this line".
2. Coverage is reported honestly: 1 captured + 0 not-medicine of 2 lines =
   50%, confidence "review" — the user is told, not reassured.
3. The questions builder escalates it into a plain question:

   > One line in my papers could not be read: "2. Rxcvf qzxv 8&&2 ???". What
   > does it say?

Unreadable-line questions are capped at six so the list stays readable. The
same escalation path produces questions for duplicates ("Two of my medicines
(2. Tab. Dolo and 3. Tab. Combiflam) both contain paracetamol. Should I be
taking both?"), look-alikes, missing durations, changed doses and
contradictions.

## Evaluation

`npm run eval` replays the corpus in `eval/corpus.json` (12 synthetic summaries,
each with a hand-written expected result) through the real agent and
writes [report.md](../eval/report.md). Thresholds fail the run on regression:
coverage ≥ 92%, name recall ≥ 90%, name precision ≥ 95%, field exact-match
(strength / frequency / duration / course) ≥ 85%. A noise suite re-runs every
case with deterministic distortions (case changes, extra whitespace, OCR-style
character swaps) and reports how the scores move. This is a regression measure
on a synthetic corpus authored by the project, not clinical validation.
