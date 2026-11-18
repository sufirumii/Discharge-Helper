# Data sources and provenance — medicine lexicon

This document explains where every table in `data/lexicon.json` comes from, how
it was verified, what could not be verified, and how to check or remove any
part of it. The lexicon is compiled by `node scripts/build-lexicon.mjs` from
the CSV files in `data/sources/`; nothing in the JSON is hand-edited. The
`builtAt` field is the constant string `see docs/DATA-SOURCES.md` (not a
timestamp) so builds are deterministic — the provenance lives in this file and
in the per-row `source` / `source_url` / `license` fields, not in a build
clock.

To rebuild: `npm run lexicon` (writes `data/lexicon.json`).
To verify the committed JSON is current: `npm run lexicon -- --check`
(exits 1 with a summary if the CSVs and the JSON disagree).

## Tables, one by one

### `data/sources/ingredients.csv` — 259 rows

One row per active ingredient (salt). Columns: `inn,alt,drug_class,used_for,
source,source_url,license`.

- `inn` is the name used in India (paracetamol, metformin, metoprolol…).
- `alt` holds `;`-separated alternate names. Where the US name differs from
  the Indian one, the US name is included, because the verification source
  (NLM RxNorm) uses US names. The six rows that verify through an alt name
  are: paracetamol→acetaminophen, clavulanic acid→clavulanate,
  ursodeoxycholic acid→ursodeoxycholate, salbutamol→albuterol,
  levosalbutamol→levalbuterol, drotaverine→drotaverin.
- `drug_class` and `used_for` are short, plain-language, general statements
  (what the class does), never patient-specific advice.
- Licence: `public domain (US National Library of Medicine)` — the content is
  derived from the RxNorm term list (see below).

Verification status of all 259 rows: **253 matched by their INN, 6 matched by
an alt name**, 0 unverified. Every run of the build script re-checks this
against the committed snapshot and refuses to write output if any row fails.

### `data/sources/brands.csv` — 298 rows

Columns: `brand,ingredients,strengths,form,default_unit,fdc,source,source_url,
license`.

- `brand` is the name without strength numbers. Variants with different
  compositions are separate rows (Glycomet vs Glycomet-GP, Pan vs Pan-D,
  Telma vs Telma-H vs Telma-AM).
- `ingredients` is a `;`-separated list of INNs, in composition order, each
  of which must exist as a row in `ingredients.csv` (enforced by the build).
- `strengths` is a JSON object: the key is the strength **digits as written in
  a prescription** (no unit — e.g. `"625"`, `"75/10"`, `"1 g"`, `"500/125"`)
  and the value is the per-ingredient strength array, in the same order as
  `ingredients`. The build fails if the array length does not match the
  ingredient count. Combination totals and per-ingredient written forms both
  appear as keys (Augmentin `625` and `500/125` map to the same array).
- Insulins carry empty strength maps (their doses are in units, written per
  patient), and the engine keeps insulin doses as written.

Two provenance tiers, recorded per row:

1. **NLM-verified tier — 47 rows** (Augmentin, Lipitor, Norvasc, Glucophage,
   Januvia, Lantus, Humalog, Synthroid, Lasix, Aldactone, Zithromax, Cipro,
   Levaquin, Flagyl, Bactrim, Protonix, Nexium, Prilosec, Ultram, Ultracet,
   Tylenol, Advil, Medrol, Reglan, Ventolin, Flovent, Singulair, Allegra,
   Xyzal, Neurontin, Lyrica, Keppra, Dilantin, Tegretol, Tenormin, Inderal,
   Zocor, Zofran-removed — see "items left out" — plus Plavix, Brilinta,
   Jardiance, Apidra, Nizoral, Benicar, Cozaar, Vesicare, Dulcolax,
   Prevacid, Lanoxin, Caduet). `source` = `NLM RxNorm brand entry (…)`,
   `source_url` = the `rxcui.json` lookup URL for that brand name,
   `license` = `public domain (US National Library of Medicine)`. Every one
   of these brand names was looked up against the live
   `rxnav.nlm.nih.gov` API during the build and returned an RxCUI.
2. **Project-authored tier — 251 rows** (Indian brands): `source` =
   `Project-authored from the published product composition; ingredient(s)
   verified via NLM RxNorm. See docs/DATA-SOURCES.md.`, `source_url` =
   `#project-authored`, `license` = `project-authored (Apache-2.0)`. See the
   provenance section below for what this tier does and does not claim.

### `data/sources/reference.csv`, tables `forms` (39 rows) and `routes` (10 rows)

Reference tables mapping Indian prescription shorthand to plain words
(`tab`→`tablet`, `syp`→`syrup`, `gtts`→`drops`, `po`→`by mouth`, `sc`→`under
the skin`, …). Project-authored, Apache-2.0.

### `data/sources/reference.csv`, table `lasa` — 12 look-alike/sound-alike pairs

`a,b,note,source,source_url` with tall-man capitalisation:
hydrALAZINE/hydrOXYzine, glipiZIDE/glyBURIDE, buPROpion/busPIRone,
predniSONE/prednisoLONE, cefTRIAXone/cefTAZidime,
chlorproMAZINE/chlorproPAMIDE, DAUNOrubicin/DOXOrubicin,
vinCRISTine/vinBLAStine, morphine/hydromorphone, clonazePAM/cloNIDine,
insulin glargine/insulin glulisine, metFORMIN/metronidazole.

Source attribution on every pair: the FDA Name Differentiation Project and/or
the ISMP List of Confused Drug Names, with the source URL recorded (see the
access note below). Indian brand look-alikes are deliberately absent — no
citable source could be fetched for them.

### `data/sources/reference.csv`, table `error_prone` — 6 entries

ISMP List of Error-Prone Abbreviations: QD, U, IU, trailing zero (1.0 mg),
no leading zero (.5 mg), MSO4. Each with the ISMP URL and the action
`ask to have this rewritten`.

### `data/sources/reference.csv`, table `high_alert` — 14 entries

ISMP List of High-Alert Medications (Acute Care) entries relevant to Indian
discharge summaries: insulin, warfarin, heparin, enoxaparin, apixaban,
rivaroxaban, dabigatran, clopidogrel, ticagrelor, morphine, methotrexate,
potassium chloride, digoxin, theophylline. Matched by substring against both
ingredient names and names as written by the engine; note:
`double-check the dose with the pharmacist`.

## RxNorm verification method

- On **2026-11-17** the build fetched
  `https://rxnav.nlm.nih.gov/REST/allconcepts.json?tty=IN` and extracted the
  14,717 ingredient (TTY=IN) names, lowercased, one per line. That snapshot is
  committed as `data/sources/rxnorm-in-terms.txt` and is the verification
  source.
- **Every** ingredients.csv row must have its `inn` (lowercased) or one of its
  `alt` names appear verbatim in that snapshot. `scripts/build-lexicon.mjs`
  re-verifies all rows on every run and exits 1 without writing output on any
  failure. The `source` column records the term that actually matched, and
  `source_url` is the `rxcui.json` lookup URL for that term.
- As an extra check on 2026-11-17, every NLM-verified brand name (the 47 rows
  of tier 1) was looked up against the live `rxnav.nlm.nih.gov` API and
  returned an RxCUI. One brand that did not — **Zofran** — was removed from
  the verified tier rather than kept on trust (Indian ondansetron brands
  Ondem, Emeset, Vomikind and Zofer cover the same ingredient).
- Unverifiable ingredients are left out entirely, not guessed (list below).

## Indian-brand provenance (the project-authored tier)

251 of 298 brand rows are Indian brands. For these, the honest position is:

- Compositions come from the project's reference dataset of **published product
  compositions** (the product labels this project was built from). Only
  compositions the project is certain about are included; anything uncertain is
  left out and listed below.
- Every **ingredient** in those rows is individually verified against the NLM
  RxNorm IN snapshot (the same check as ingredients.csv — the build fails if a
  brand references an unknown or unverified ingredient).
- The compositions themselves were **not re-verified against fetchable official
  sources**, because from the build sandbox:
  - `janaushadhi.gov.in` (Pradhan Mantri Bhartiya Janaushadhi Pariyojana)
    returns a JavaScript application shell (~4 KB of SPA boot HTML, no
    server-rendered product data);
  - `cdsco.gov.in` was unreachable (connection failed);
  - the NLEM 2022 list had no fetchable endpoint from the build environment.
- Where a label contains an ingredient that could not be verified in RxNorm,
  the row carries only the verified subset and the omission is recorded:
  - **Digene** — magnesium hydroxide + simethicone (the antacid subset that
    verifies; the full label lists more).
  - **Cremaffin Plus** — magnesium hydroxide + mineral oil + lactulose.
  - **Zincovit** — an 8-ingredient subset of a wider multivitamin label.
  - **Becosules** — a B-complex + vitamin C subset.
  - **Ascoril LS** — levosalbutamol + ambroxol + guaifenesin.
- **How to audit or remove this tier:** filter `brands.csv` rows where
  `source_url` is `#project-authored` (e.g.
  `awk -F, '$8 != "#project-authored"' data/sources/brands.csv`). The 47
  NLM-verified rows survive any such purge untouched, and re-running the
  build produces a consistent lexicon without them.

## FDA / ISMP reference lists — a note on access

The ISMP pages (`error-prone-abbreviations-list`,
`high-alert-medications-acute-list`) return HTTP 520 to the build sandbox, and
the FDA Name Differentiation page returns HTTP 401 — they are bot-walled from
this environment. The entries above are taken from the published list content,
with the source URLs recorded on every row so a human can re-verify them
manually. This is stated here rather than hidden.

## Items left out, and why

**Ingredients not in the RxNorm IN snapshot (so left out per the verification
rule):**

- `mefenamic acid` — so the brands **Meftal** and **Meftal-Spas** are absent
  too (dicyclomine itself is present via Cyclopam).
- `isosorbide mononitrate` (the snapshot has isosorbide dinitrate only) — so
  **Monotrate** is also absent from brands.
- `sodium picosulfate`, `faropenem`, `methylcobalamin`, `etizolam`,
  `aluminium hydroxide` (so **Gelusil** is absent), `doxofylline`,
  `croscarmellose sodium`.
- `pancrelipase` — `pancreatin` (which is in the snapshot) is used for Creon.
- `cyanocobalamin` — the row is named `vitamin B12` (the snapshot term) with
  `cyanocobalamin` as an alt.
- `insulin NPH` — `insulin isophane` (RxNorm's IN term for the same thing) is
  used throughout.

**Brands left out (composition not certain enough, or a matching hazard):**

- `Monocef O` — the project is not certain enough of the exact composition to
  commit a row; the engine's unknown-medicine path handles it safely (name
  copied exactly, flagged for review).
- `Alkasol`, `Etizola`, `Sinarest`, `Alex`, `Ascoril D`, `Drotin Plus`,
  `Gelusil`, `Liv 52` (ayurvedic), `Supradyn` (wide multivitamin label),
  and several single-salt variants where the base brand already resolves.

**Deliberate quirks, recorded honestly:**

- A prescription line like "Tab. Glycomet GP2" keeps "GP2" inside the medicine
  name; the resolver's qualifier trimming then lands on plain **Glycomet**
  (metformin) rather than Glycomet-GP (metformin + glimepiride). The
  glimepiride half is therefore not asserted for that spelling — the safe
  reading. Writing it as "Glycomet-GP 2" resolves fully.
- Insulin lines keep their dose in units exactly as written and are marked
  high-alert (double-check with the pharmacist).
- Fuzzy name matching requires the same first letter and a bounded edit
  distance, and never auto-accepts a match that lands on a look-alike pair —
  an unreadable name stays unknown and is shown to the user as-is.
