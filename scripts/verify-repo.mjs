#!/usr/bin/env node
/**
 * verify-repo — the repository hygiene gate (runs as part of `npm run verify`).
 *
 * Fails when:
 *  - source or built output contains a forbidden model-era word
 *    (firebase, gemini, openai, anthropic, transformers, onnx, tensorflow,
 *    webllm, llama, devpost, buildhybridai)
 *  - a source file contains a version-theatre word (v1.0, MVP, TODO, FIXME,
 *    phase) — "phase" is checked as a whole word so honest words like
 *    "emphasis" survive
 *  - any http(s):// URL appears in src/ or public/ that is not on the
 *    allow-list (verified evidence and reference sources; documentation .md
 *    files may contain the same allow-listed URLs)
 *  - package.json carries a version field, or an .env file exists
 *  - the lexicon CSVs contain a row without provenance (also enforced by the
 *    build script)
 *  - the committed data/lexicon.json is stale (delegate to build --check)
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, extname, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "dist" || name === ".github") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// ── 1. Forbidden words in source ────────────────────────────────────────────

// Word-boundary matching avoids false positives inside longer strings (a
// Unicode glyph name inside the bundled pdf.js worker contains "llama").
const FORBIDDEN = [
  "firebase", "gemini", "openai", "anthropic", "transformers", "onnx",
  "tensorflow", "webllm", "llama", "devpost", "buildhybridai", "appcheck",
  "recaptcha", "inferencesource", "vertexai",
].map((w) => [w, new RegExp(`\\b${w}\\b`, "i")]);
const WORD_PATTERNS = [
  ["v1.0", /\bv1\.0\b/i],
  ["MVP", /\bMVP\b/],
  ["TODO", /\bTODO\b/],
  ["FIXME", /\bFIXME\b/],
  ["phase", /\bphase\b/i],
];

const sourceExts = new Set([".ts", ".tsx", ".css", ".html", ".json", ".js", ".mjs", ".webmanifest"]);
const sourceDirs = ["src", "public", "scripts", "tests", "eval", "data"];
const sourceFiles = [];
for (const dir of sourceDirs) {
  const p = join(root, dir);
  if (existsSync(p)) sourceFiles.push(...walk(p));
}
for (const f of sourceFiles) {
  const rel = relative(root, f);
  if (rel === join("scripts", "verify-repo.mjs")) continue; // this checker's own lists
  if (!sourceExts.has(extname(f)) && extname(f) !== ".txt") continue;
  const text = readFileSync(f, "utf-8");
  for (const [bad, re] of FORBIDDEN) {
    if (re.test(text)) {
      errors.push(`${rel}: contains the forbidden word "${bad}"`);
    }
  }
  for (const [label, re] of WORD_PATTERNS) {
    if (re.test(text)) {
      errors.push(`${rel}: contains the word "${label}"`);
    }
  }
}

// ── 2. dist build has no forbidden words ────────────────────────────────────

const distDir = join(root, "dist");
if (existsSync(distDir)) {
  const distFiles = walk(distDir);
  for (const f of distFiles) {
    if (!sourceExts.has(extname(f))) continue;
    const text = readFileSync(f, "utf-8");
    for (const [bad, re] of FORBIDDEN) {
      if (re.test(text)) {
        errors.push(`dist/${relative(distDir, f)}: contains the forbidden word "${bad}"`);
      }
    }
  }
}

// ── 3. URL allow-list in src/ and public/ ──────────────────────────────────

// Every external URL that is allowed to appear in code. These are the verified
// evidence and reference sources shown in the UI with their links; the same
// URLs may also appear in documentation.
const ALLOWED_URL_PREFIXES = [
  "https://jyoungpharm.org/article/9/3/441",
  "https://www.freepressjournal.in/",
  "https://pmc.ncbi.nlm.nih.gov/articles/PMC3575734",
  "https://pmc.ncbi.nlm.nih.gov/articles/PMC3575742",
  "https://pubmed.ncbi.nlm.nih.gov/24998906/",
  "https://kffhealthnews.org/",
  "https://www.mha.gov.in/",
  "https://www.gov.uk/foreign-travel-advice/india",
  "https://www.ahrq.gov/",
  "https://www.fda.gov/drugs/medication-errors-related-cder-regulated-drug-products/name-differentiation-project",
  "https://www.ismp.org/recommendations/",
  "https://rxnav.nlm.nih.gov/REST/",
  "https://wa.me/",
];

const urlRe = /https?:\/\/[^\s"'`)]+/g;
for (const f of sourceFiles) {
  const rel = relative(root, f);
  if (!rel.startsWith("src") && !rel.startsWith("public")) continue;
  if (extname(f) === ".txt") continue; // snapshot data, not URLs
  if (rel.startsWith(join("public", "ocr"))) {
    // Vendored text-recogniser files carry dormant default CDN URLs in their
    // bundled code; the app always passes explicit same-origin paths, and the
    // deployed CSP (connect-src 'self') makes any other fetch impossible.
    continue;
  }
  const text = readFileSync(f, "utf-8");
  for (const m of text.matchAll(urlRe)) {
    const url = m[0].replace(/[.,;)]+$/, "");
    if (!ALLOWED_URL_PREFIXES.some((p) => url.startsWith(p))) {
      errors.push(`${rel}: external URL not on the allow-list: ${url}`);
    }
  }
}

// ── 4. package.json / env hygiene ───────────────────────────────────────────

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
if (pkg.version !== undefined) {
  errors.push("package.json still carries a version field");
}
for (const envish of [".env", ".env.local", ".env.example"]) {
  if (existsSync(join(root, envish))) {
    errors.push(`${envish} exists — the app must need no environment file`);
  }
}

// ── 5. lexicon provenance + freshness (delegates to the build script) ──────

try {
  execFileSync(process.execPath, [join(root, "scripts", "build-lexicon.mjs"), "--check"], {
    stdio: "pipe",
  });
} catch (err) {
  errors.push(`lexicon check failed: ${(err.stdout?.toString() ?? err.message).trim()}`);
}

// ── Report ──────────────────────────────────────────────────────────────────

if (errors.length > 0) {
  console.error(`verify-repo: FAIL — ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  "verify-repo: OK — no forbidden words, no version theatre, no unlisted external URLs, no env files, lexicon provenance complete and current.",
);
