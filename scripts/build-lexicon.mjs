#!/usr/bin/env node
/**
 * build-lexicon — generates data/lexicon.json from the source CSVs in
 * data/sources/, validating as it goes:
 *   - every row carries provenance (source, source_url, license)
 *   - every ingredient is verified against the committed NLM RxNorm IN
 *     snapshot (data/sources/rxnorm-in-terms.txt) by its INN or an alt name
 *   - every ingredient referenced by a brand exists
 *   - FDC strength arrays match the ingredient count
 *   - no duplicate brands or ingredients
 *
 * Usage:
 *   node scripts/build-lexicon.mjs          build data/lexicon.json
 *   node scripts/build-lexicon.mjs --check  verify the committed file matches
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "data", "sources");
const outFile = join(root, "data", "lexicon.json");

/** Minimal RFC-4180 CSV parser (quoted fields, escaped quotes, CRLF). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const s = text.replace(/^\uFEFF/, "");
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, idx) => [h, r[idx] ?? ""])));
}

function fail(message) {
  console.error(`build-lexicon: FAIL — ${message}`);
  process.exit(1);
}

function readCsv(name, requiredCols, table) {
  const path = join(srcDir, name);
  if (!existsSync(path)) fail(`${name} is missing`);
  let rows = parseCsv(readFileSync(path, "utf-8"));
  if (table) rows = rows.filter((r) => r.table === table);
  for (const [idx, row] of rows.entries()) {
    for (const col of requiredCols) {
      if (!row[col] || !row[col].trim()) {
        fail(`${name} row ${idx + 2}: empty required column "${col}"`);
      }
    }
  }
  return rows;
}

// ── Load and validate ───────────────────────────────────────────────────────

const ingredients = readCsv("ingredients.csv", ["inn", "drug_class", "used_for", "source", "source_url", "license"]);
const brands = readCsv("brands.csv", ["brand", "ingredients", "strengths", "form", "default_unit", "fdc", "source", "source_url", "license"]);
const forms = readCsv("reference.csv", ["key", "label", "source", "source_url", "license"], "forms");
const routes = readCsv("reference.csv", ["key", "label", "source", "source_url", "license"], "routes");
const lasa = readCsv("reference.csv", ["a", "b", "note", "source", "source_url"], "lasa");
const errorProne = readCsv("reference.csv", ["pattern", "why", "action", "source", "source_url"], "error_prone");
const highAlert = readCsv("reference.csv", ["match", "note", "source", "source_url"], "high_alert");

// RxNorm snapshot verification.
const snapPath = join(srcDir, "rxnorm-in-terms.txt");
if (!existsSync(snapPath)) fail("rxnorm-in-terms.txt snapshot is missing");
const snapshot = new Set(
  readFileSync(snapPath, "utf-8")
    .split(/\r?\n/)
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean),
);

const normKey = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const ingredientKeys = new Map();
let innMatched = 0;
let altMatched = 0;
const unmatched = [];

for (const row of ingredients) {
  const inn = row.inn.trim();
  const alts = row.alt ? row.alt.split(";").map((a) => a.trim()).filter(Boolean) : [];
  const all = [inn, ...alts];
  const hit = all.find((t) => snapshot.has(t.toLowerCase()));
  if (!hit) {
    unmatched.push(inn);
    continue;
  }
  if (hit === inn) innMatched += 1;
  else altMatched += 1;
  const key = normKey(inn);
  if (ingredientKeys.has(key)) fail(`duplicate ingredient: ${inn}`);
  if (!/^https:\/\/|^\{|#project-authored$/.test(row.source_url) && !row.source_url.startsWith("#")) {
    fail(`ingredient ${inn}: source_url must be an https URL or the internal anchor`);
  }
  ingredientKeys.set(key, {
    inn,
    alt: alts,
    drugClass: row.drug_class.trim(),
    usedFor: row.used_for.trim(),
    source: row.source.trim(),
    sourceUrl: row.source_url.trim(),
    license: row.license.trim(),
  });
}
if (unmatched.length > 0) {
  fail(`ingredients not found in the RxNorm snapshot: ${unmatched.join(", ")}`);
}

const brandKeys = new Map();
for (const row of brands) {
  const brand = row.brand.trim();
  const key = normKey(brand);
  if (brandKeys.has(key)) fail(`duplicate brand: ${brand}`);
  const ings = row.ingredients.split(";").map((i) => i.trim()).filter(Boolean);
  if (ings.length === 0) fail(`brand ${brand}: no ingredients listed`);
  for (const ing of ings) {
    if (!ingredientKeys.has(normKey(ing))) {
      fail(`brand ${brand}: ingredient "${ing}" is not in ingredients.csv`);
    }
  }
  let strengths = {};
  try {
    strengths = JSON.parse(row.strengths || "{}");
  } catch (err) {
    fail(`brand ${brand}: strengths is not valid JSON (${err.message})`);
  }
  for (const [k, arr] of Object.entries(strengths)) {
    if (!Array.isArray(arr) || arr.length !== ings.length) {
      fail(`brand ${brand}: strength key "${k}" has ${Array.isArray(arr) ? arr.length : "non-array"} entries, expected ${ings.length}`);
    }
  }
  if (!/^https:\/\/|^#/.test(row.source_url.trim())) {
    fail(`brand ${brand}: source_url must be an https URL or the internal anchor`);
  }
  brandKeys.set(key, {
    brand,
    ingredients: ings,
    strengths,
    defaultUnit: row.default_unit.trim(),
    form: row.form.trim(),
    fdc: row.fdc.trim().toLowerCase() === "yes" || ings.length > 1,
    source: row.source.trim(),
    sourceUrl: row.source_url.trim(),
    license: row.license.trim(),
  });
}

// ── Build the lexicon ───────────────────────────────────────────────────────

const lexicon = {
  builtAt: "see docs/DATA-SOURCES.md",
  counts: {
    ingredients: ingredientKeys.size,
    brands: brandKeys.size,
    lasaPairs: lasa.length,
    errorProne: errorProne.length,
    highAlert: highAlert.length,
  },
  ingredients: [...ingredientKeys.values()].sort((a, b) => a.inn.localeCompare(b.inn)),
  brands: [...brandKeys.values()].sort((a, b) => a.brand.localeCompare(b.brand)),
  forms: Object.fromEntries(forms.map((r) => [r.key.trim(), r.label.trim()])),
  routes: Object.fromEntries(routes.map((r) => [r.key.trim(), r.label.trim()])),
  lasaPairs: lasa.map((r) => ({
    a: r.a.trim(),
    b: r.b.trim(),
    note: r.note.trim(),
    source: r.source.trim(),
    sourceUrl: r.source_url.trim(),
  })),
  errorProne: errorProne.map((r) => ({
    pattern: r.pattern.trim(),
    why: r.why.trim(),
    action: r.action.trim(),
    source: r.source.trim(),
    sourceUrl: r.source_url.trim(),
  })),
  highAlert: highAlert.map((r) => ({
    match: r.match.trim(),
    note: r.note.trim(),
    source: r.source.trim(),
    sourceUrl: r.source_url.trim(),
  })),
};

const json = JSON.stringify(lexicon, null, 2) + "\n";

// ── Write or check ──────────────────────────────────────────────────────────

const rxVerified = ingredients.filter((r) => r.source_url.startsWith("https://rxnav")).length;
const usBrandCount = [...brandKeys.values()].filter((b) => b.sourceUrl.startsWith("https://rxnav")).length;

if (process.argv.includes("--check")) {
  if (!existsSync(outFile)) fail("data/lexicon.json is missing — run node scripts/build-lexicon.mjs");
  const committed = readFileSync(outFile, "utf-8");
  if (committed !== json) {
    fail(
      "data/lexicon.json is out of date with data/sources/*.csv — regenerate with: node scripts/build-lexicon.mjs",
    );
  }
  console.log(
    `build-lexicon: OK — ${ingredientKeys.size} ingredients (all verified against the RxNorm snapshot; ${innMatched} by INN, ${altMatched} by alt name), ${brandKeys.size} brands (${usBrandCount} with an NLM RxNorm brand URL), ${lasa.length} look-alike pairs, ${errorProne.length} error-prone abbreviations, ${highAlert.length} high-alert classes. rxVerified=${rxVerified}`,
  );
} else {
  writeFileSync(outFile, json);
  console.log(
    `build-lexicon: wrote data/lexicon.json — ${ingredientKeys.size} ingredients (${innMatched} INN-matched, ${altMatched} alt-matched), ${brandKeys.size} brands (${usBrandCount} NLM-verified), ${lasa.length} LASA pairs, ${errorProne.length} error-prone abbreviations, ${highAlert.length} high-alert classes.`,
  );
}
