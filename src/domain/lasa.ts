/**
 * lasa — look-alike / sound-alike guard. Pairs live in data/sources/reference.csv
 * and reach this module through the built lexicon, so every pair carries its
 * source URL. Indian brand look-alikes are deliberately absent: no citable
 * source could be fetched for them (see docs/DATA-SOURCES.md).
 */

import type { MedFlag, StructuredMed } from "@/engine/types";

export interface LasaPair {
  a: string;
  b: string;
  note: string;
  source: string;
  sourceUrl: string;
}

function norm(n: string): string {
  return n.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface LasaHit {
  medName: string;
  pair: LasaPair;
  /** The OTHER name in the pair (the one it can be confused with). */
  confusedWith: string;
}

/** Which of the patient's medicines are look-alike/sound-alike risky. */
export function findLasas(medNames: string[], pairs: LasaPair[]): LasaHit[] {
  const hits: LasaHit[] = [];
  for (const name of medNames) {
    for (const p of pairs) {
      const an = norm(p.a);
      const bn = norm(p.b);
      const n = norm(name);
      if (n === an) hits.push({ medName: name, pair: p, confusedWith: p.b });
      else if (n === bn) hits.push({ medName: name, pair: p, confusedWith: p.a });
      else if (n.length >= 5 && (an.startsWith(n.slice(0, 5)) || bn.startsWith(n.slice(0, 5)))) {
        // Near prefix collision beyond exact pair (e.g. brand + generic).
        // Only flag when reasonably close in length.
        if (Math.abs(n.length - an.length) <= 4 || Math.abs(n.length - bn.length) <= 4) {
          hits.push({ medName: name, pair: p, confusedWith: an.startsWith(n) || n === an ? p.b : p.a });
        }
      }
    }
  }
  // Deduplicate by medName+pair.
  const seen = new Set<string>();
  return hits.filter((h) => {
    const k = `${norm(h.medName)}|${norm(h.pair.a)}|${norm(h.pair.b)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Build per-medicine LASA flags (used by the safety auditor). */
export function lasaFlags(meds: StructuredMed[], pairs: LasaPair[]): Map<string, MedFlag> {
  const byName = new Map<string, StructuredMed>();
  for (const m of meds) {
    byName.set(norm(m.nameAsWritten), m);
    for (const ing of m.resolved.ingredients) byName.set(norm(ing.name), m);
  }
  const out = new Map<string, MedFlag>();
  for (const hit of findLasas([...byName.keys()], pairs)) {
    const med = byName.get(norm(hit.medName));
    if (!med) continue;
    if (out.has(med.id)) continue;
    out.set(med.id, {
      kind: "lasa",
      message: `"${hit.medName}" looks or sounds like "${hit.confusedWith}" — ${hit.pair.note}`,
      detail: hit.confusedWith,
    });
  }
  return out;
}

export const LASA_DISCLAIMER =
  "Reference lists from the FDA and ISMP. They do not cover every possible mix-up. Verify with your pharmacist.";
