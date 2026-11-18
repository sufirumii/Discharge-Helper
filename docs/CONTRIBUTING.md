# Contributing

Short and practical. `npm run verify` must pass before any change is merged;
it runs lint, typecheck, the unit tests, the lexicon check, the evaluation,
the build and the repo check.

## Add a medicine to the lexicon

1. Edit `data/sources/ingredients.csv` (columns: `inn`, `alt`, `drug_class`,
   `used_for`, `source`, `source_url`, `license`) or `data/sources/brands.csv`
   (columns: `brand`, `ingredients`, `strengths`, `form`, `default_unit`,
   `fdc`, `source`, `source_url`, `license`). The provenance columns are
   required — the build fails without a source and a licence.
2. Rules the build enforces:
   - Every ingredient must be verified against the committed NLM RxNorm IN
     snapshot (`data/sources/rxnorm-in-terms.txt`) by its `inn` or one of its
     `alt` names. If the term is not in the snapshot, the medicine is left
     out, not guessed.
   - Every ingredient referenced by a brand must exist in `ingredients.csv`.
   - `strengths` maps the digits as written in a prescription (`"625"`,
     `"500/125"`) to one strength string per ingredient, in composition order.
   - `fdc` is `yes` exactly when there are two or more ingredients.
   - `source_url` must be an `https` URL or the internal anchor
     `#project-authored` (see [DATA-SOURCES.md](DATA-SOURCES.md) for the two
     provenance tiers).
3. Run `npm run lexicon` (or `node scripts/build-lexicon.mjs`) to regenerate
   `data/lexicon.json`, then run the tests. `npm run lexicon -- --check`
   verifies the committed JSON matches the CSVs.

## Add a phrase

Patient-facing strings come from the reviewed phrase tables in `data/`
(`data/phrases.json`, with `en`, `hi` and `te` tables). All three tables
must stay in sync: a key added to English is added to Hindi and Telugu in the
same change. `missingKeys` in `src/i18n/index.ts` lists any English key a
translation is missing. Drug names, strengths and numbers are never
translated — they are inserted as `{variables}` and stay exactly as written in
the papers.

## Add a test case

- **A sig case:** add a row to the `CASES` table in
  `tests/sig.test.ts` — the line plus the expected fields (`name`,
  `form`, `strength`, `doseText`, `freq`, `freqPerDay`, `when`, `prn`,
  `timing`, `route`, `duration`, `days`, `course`, or `reject` for lines the
  grammar must refuse).
- **A corpus case:** add an entry to `eval/corpus.json` with an `id`, the `text` (a synthetic
  discharge summary) and its hand-written `expected` result
  (`medications` with `name`, `strength`, `frequencyText`, `durationDays`,
  `durationKind`, `course`, plus `followups` and `warnings` counts). Then run
  `npm run eval`, which replays the corpus through the real agent and writes
  `eval/report.md`.
- Quantity rules have their own table in
  `tests/engine.test.ts` (`line → days, units, refill date`).

## Repo rules

- No leftover work markers, no version numbers and no roadmap talk in the
  source or the docs — the repo check looks for these.
- The engine is deterministic: the same input text plus the same options must
  give a byte-identical result. Do not introduce randomness (`Math.random`)
  or wall-clock time into a result.
- Every extracted fact records a span into the text the user confirmed. New
  extraction code must keep that true.
- Plain short sentences, no marketing language, British/Indian spellings to
  match the code (recogniser, normalise). Every external claim carries its
  source link; no unverified numbers.
- New runtime dependencies need a justification in the pull request: what
  they replace, their licence, and proof they load nothing from another
  origin (see [the security section of SAFETY.md](SAFETY.md#security)).
