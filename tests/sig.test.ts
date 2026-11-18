import { describe, expect, it } from "vitest";
import { parseMedLine, parseFrequencyToken, parseSlotForm } from "@/engine/sig";

interface SigCase {
  line: string;
  name?: string | null;
  form?: string;
  strength?: string;
  doseText?: string;
  freq?: string;
  freqPerDay?: number;
  when?: string[];
  prn?: boolean;
  timing?: string;
  route?: string;
  duration?: "fixed" | "continue" | "till-review" | "lifelong" | "missing";
  days?: number;
  course?: string;
  reject?: boolean;
}

const CASES: SigCase[] = [
  // ── Forms and prefixes ─────────────────────────────────────────────────
  { line: "Tab. Telma 40 1-0-0", name: "Telma", form: "tab", strength: "40", freq: "1-0-0" },
  { line: "Tah. Betaloc 25 mg 1-0-1", name: "Betaloc", form: "tab", strength: "25 mg" },
  { line: "Tab Dolo 650 mg 1-1-1", name: "Dolo", form: "tab", strength: "650 mg", freq: "1-1-1" },
  { line: "Cap. Omez 20 1-0-0", name: "Omez", form: "cap", strength: "20" },
  { line: "Cap Augmentin 625 mg 1-1-1 x 5 days", name: "Augmentin", form: "cap", strength: "625 mg", duration: "fixed", days: 5 },
  { line: "Syp. Ascoril LS 10 ml 1-0-1", name: "Ascoril LS", form: "syrup", doseText: "10 ml" },
  { line: "Syp Digene 10 ml SOS", name: "Digene", form: "syrup", doseText: "10 ml", prn: true },
  { line: "Inj. Glaritus 20 units SC at bedtime", name: "Glaritus", form: "inj", doseText: "20 units", route: "under the skin" },
  { line: "Oint. T-Bact apply over wound BD x 7 days", name: "T-Bact", form: "ointment", duration: "fixed", days: 7 },
  { line: "Ciplox drops 2 drops both eyes QID", name: "Ciplox", form: "drops", doseText: "2 drops" },
  { line: "Foracort 200 rotacap 1 cap inhalation BD", name: "Foracort", form: "rotacap", strength: "200", doseText: "1 cap" },
  { line: "Duolin respules 1 respule BD via nebuliser", name: "Duolin", form: "respule", doseText: "1 respule" },
  { line: "Otrivin nasal drops 2 drops each nostril HS", name: "Otrivin nasal", form: "drops", doseText: "2 drops" },
  { line: "Tab. Cremaffin Plus 15 ml HS", name: "Cremaffin Plus", form: "tab", doseText: "15 ml" },
  { line: "Suppository Ducolax 10 mg PR HS", name: "Ducolax", form: "suppository" },
  { line: "Nicholas powder 1 sachet OD", name: "Nicholas", form: "powder", doseText: "1 sachet" },
  { line: "Omnacortil 5 mg 1-0-0 via oral", name: "Omnacortil" },

  // ── Strength forms ──────────────────────────────────────────────────────
  { line: "Ecosprin AV 75/10 1-0-0", name: "Ecosprin AV", strength: "75/10" },
  { line: "Tab Glycomet 500 mg 1-0-1", strength: "500 mg" },
  { line: "Neurobion 1000 mcg 1-0-0", strength: "1000 mcg" },
  { line: "Azithral 500 mg OD x 3 days", strength: "500 mg", duration: "fixed", days: 3 },
  { line: "Telma 40 mg OD", strength: "40 mg" },
  { line: "Shelcal 500 1-0-0", strength: "500" },
  { line: "Pan 40 1-0-0 before food", strength: "40", timing: "before food" },
  { line: "Betadine 10 % apply BD", strength: "10 %" },

  // ── Dose forms ──────────────────────────────────────────────────────────
  { line: "Dolo 650 1 tab SOS", doseText: "1 tab", name: "Dolo" },
  { line: "Crocin ½ tab BD", doseText: "½ tab" },
  { line: "Combiflam 1-2 tab TDS", doseText: "1-2" },
  { line: "Asthalin inhaler 2 puffs SOS", doseText: "2 puffs", name: "Asthalin" },
  { line: "Lantus 24 units SC HS", doseText: "24 units", name: "Lantus" },
  { line: "Mixtard 30/70 20 units SC before breakfast", doseText: "20 units", name: "Mixtard" },
  { line: "Zincovit 1 tab 1-0-0", doseText: "1 tab" },
  { line: "Metolar XR 25 ½-0-½", doseText: "½-0-½" },

  // ── Frequency: Indian and Latin sig codes ───────────────────────────────
  { line: "Telma 40 OD", freq: "od", freqPerDay: 1, when: ["MORN"] },
  { line: "Glycomet 500 BD", freq: "bd", freqPerDay: 2 },
  { line: "Betaloc 50 BID", freq: "bid", freqPerDay: 2 },
  { line: "Augmentin 625 TDS", freq: "tds", freqPerDay: 3 },
  { line: "Pan 40 TID", freq: "tid", freqPerDay: 3 },
  { line: "Cyclopam QID", freq: "qid", freqPerDay: 4 },
  { line: "Rantac QDS 1-0-0-1", freq: "qds", freqPerDay: 4 },
  { line: "Atorva 10 HS", freq: "hs", freqPerDay: 1, when: ["NIGHT"] },
  { line: "Deriphyllin QHS", freq: "qhs", freqPerDay: 1 },
  { line: "Shelcal OM", freq: "om", freqPerDay: 1 },
  { line: "Allegra ON", freq: "on", freqPerDay: 1 },
  { line: "Digene SOS", prn: true, name: "Digene" },
  { line: "Combiflam PRN for pain", prn: true },
  { line: "Avil 25 STAT", freq: "stat", freqPerDay: 1 },
  { line: "Heparin QOD", freq: "qod" },
  { line: "Tab. Hetragen Q8H", freq: "q8h", freqPerDay: 3 },
  { line: "Ibuprofen every 8 hours", freq: "every 8 hours", freqPerDay: 3 },
  { line: "Paracetamol Q6H", freq: "q6h", freqPerDay: 4 },
  { line: "Cefixime Q12H", freq: "q12h", freqPerDay: 2 },
  { line: "Metformin once a day", freq: "once a day", freqPerDay: 1 },
  { line: "Amlodipine once daily", freq: "once daily", freqPerDay: 1 },
  { line: "Pantoprazole daily", freq: "daily", freqPerDay: 1 },
  { line: "Ultracet twice daily", freq: "twice daily", freqPerDay: 2 },
  { line: "Azithral thrice a day", freq: "thrice a day", freqPerDay: 3 },
  { line: "Cetirizine at bedtime", freq: "at bedtime", freqPerDay: 1, when: ["NIGHT"] },
  { line: "Calcium tablet at night", freq: "at night", freqPerDay: 1, when: ["NIGHT"] },
  { line: "Vitamin D once a week", freq: "once a week" },
  { line: "Alendronate once a week on Sunday", freq: "once a week on sunday", freqPerDay: 1 },
  { line: "Atorvastatin alternate days", freq: "alternate days" },
  { line: "Levothyroxine every other day", freq: "every other day" },

  // ── Slot forms 1-0-1 and variants ───────────────────────────────────────
  { line: "Telma 40 1-0-1", freq: "1-0-1", freqPerDay: 2, when: ["MORN", "NOON", "NIGHT"], doseText: "1-0-1" },
  { line: "Glycomet 500 1+0+1", freq: "1+0+1", freqPerDay: 2, when: ["MORN", "NOON", "NIGHT"] },
  { line: "Augmentin 1-1-1", freq: "1-1-1", freqPerDay: 3, when: ["MORN", "NOON", "NIGHT"] },
  { line: "Pan 0-0-1", freq: "0-0-1", freqPerDay: 1, when: ["MORN", "NOON", "NIGHT"], doseText: "0-0-1" },
  { line: "Zincovit 1-0-0", freq: "1-0-0", freqPerDay: 1, when: ["MORN", "NOON", "NIGHT"], doseText: "1-0-0" },
  { line: "Allegra 1-0-0-1", freq: "1-0-0-1", freqPerDay: 2 },
  { line: "Metolar ½-0-½", freq: "½-0-½", freqPerDay: 2, when: ["MORN", "NOON", "NIGHT"], doseText: "½-0-½" },
  { line: "Omnacortil 10 mg 1-0-0 x 5 days", freq: "1-0-0", duration: "fixed", days: 5 },

  // ── Timing ──────────────────────────────────────────────────────────────
  { line: "Glycomet 500 AC", timing: "before food" },
  { line: "Pan 40 PC", timing: "after food" },
  { line: "Metformin before food", timing: "before food" },
  { line: "Calcium carbonate after food", timing: "after food" },
  { line: "Augmentin with food", timing: "with food" },
  { line: "Alendronate empty stomach", timing: "on an empty stomach" },
  { line: "Thyronorm before breakfast", timing: "before food" },
  { line: "Glyciphage after lunch BD", timing: "after food" },
  { line: "Creon after dinner", timing: "after food" },

  // ── Duration ────────────────────────────────────────────────────────────
  { line: "Augmentin 625 BD x 5 days", duration: "fixed", days: 5 },
  { line: "Azithral 500 for 3 days", duration: "fixed", days: 3 },
  { line: "Doxycycline 100 5d", duration: "fixed", days: 5 },
  { line: "Cefixime for 2 weeks", duration: "fixed", days: 14 },
  { line: "Iron tablet x 1 month", duration: "fixed", days: 30 },
  { line: "Augmentin 625 5 days", duration: "fixed", days: 5 },
  { line: "Telma 40 till review", duration: "till-review" },
  { line: "Rosuvas 10 till next visit", duration: "till-review" },
  { line: "Glycomet 500 continue", duration: "continue" },
  { line: "Thyronorm continued lifelong", duration: "continue" },
  { line: "Aspirin lifelong", duration: "lifelong" },
  { line: "Digene SOS for 3 days", prn: true },
  { line: "Pan 40 1-0-0", duration: "missing" },

  // ── Routes ──────────────────────────────────────────────────────────────
  { line: "Ondansetron 4 mg SL", route: "under the tongue" },
  { line: "Ceftriaxone 1 g IV BD", route: "into a vein" },
  { line: "Diclofenac 75 mg IM OD", route: "into a muscle" },
  { line: "Lactulose PO 15 ml HS", route: "by mouth" },

  // ── Course shapes ───────────────────────────────────────────────────────
  { line: "Tab Metolar stop", course: "stop" },
  { line: "Aspirin D/C", course: "stop" },
  { line: "Warfarin discontinued", course: "stop" },
  { line: "Furosemide omit next dose", course: "stop" },
  { line: "Dytor 10 hold till cardiology review", course: "hold" },
  { line: "Metformin 500 started", course: "start" },
  { line: "Amlodipine 5 increased to 10 mg", course: "change" },
  { line: "Metoprolol 25 reduced to 12.5 mg", course: "change" },
  { line: "Atorva 20 changed to 40", course: "change" },
  { line: "Omnacortil 20 mg x 3 days, then 10 mg x 3 days, then 5 mg x 3 days, then stop", course: "taper" },
  { line: "Wysolone 40 mg 1-0-0 x 5 days, then 20 mg x 5 days, then 10 mg x 5 days", course: "taper" },

  // ── Negation and allergies never become medicines ───────────────────────
  { line: "Avoid NSAIDs", reject: true },
  { line: "Allergic to penicillin", reject: true },
  { line: "No known drug allergies", reject: true },
  { line: "NO aspirin", reject: true },
  { line: "Patient is allergic to sulpha drugs", reject: true },

  // ── Non-medicine lines rejected by the shape gate ───────────────────────
  { line: "Walk 20 minutes daily from next week", reject: true },
  { line: "Patient stable, vitals normal", reject: true },
  { line: "Review after 7 days", reject: true },
  { line: "Low salt diet advised", reject: true },
  { line: "Discharge prepared by Dr. Meera Krishnan MD DM", reject: true },
  { line: "Wound healthy at discharge", reject: true },
  { line: "Strict salt restriction", reject: true },
  { line: "Contact 98450 12345 for queries", reject: true },

  // ── Messy OCR-like input ───────────────────────────────────────────────
  { line: "Tah. Betaloc 25 mg 1-0-1", name: "Betaloc", form: "tab" },
  { line: "Tab G1ycomet 500 1-0-1", name: "G1ycomet" }, // OCR digit in name — fuzzy-matched to Glycomet
  { line: "Tab.  Dolo   650   1-1-1", name: "Dolo", strength: "650" },

  // ── Insulin specifics ───────────────────────────────────────────────────
  { line: "Inj Human Actrapid 8 units SC before breakfast and 6 units before dinner", doseText: "8 units", freq: "before breakfast and before dinner", freqPerDay: 2 },
  { line: "Inj Lantus 18 units SC HS", doseText: "18 units", name: "Lantus" },
  { line: "NovoRapid 10 units SC before lunch", doseText: "10 units" },

  // ── Brand+strength with known composition ───────────────────────────────
  { line: "Janumet 50/500 1-0-1", name: "Janumet", strength: "50/500" },
  { line: "Glycomet-GP2 1-0-1", name: "Glycomet-GP2" },
  { line: "Pan-D 1-0-0 before breakfast", name: "Pan-D", timing: "before food" },
  { line: "Ecosprin AV 75/10 1-0-0 after breakfast", name: "Ecosprin AV" },
  { line: "Telma-H 40 1-0-0", name: "Telma-H", strength: "40" },
  { line: "Zerodol SP 1-0-0 x 3 days after food", name: "Zerodol SP", duration: "fixed", days: 3, timing: "after food" },

  // ── More frequency words ────────────────────────────────────────────────
  { line: "Pantoprazole every day", freq: "every day", freqPerDay: 1 },
  { line: "Inj. Insulin 10 units every 12 hours", freq: "every 12 hours", freqPerDay: 2, doseText: "10 units" },
  { line: "Neurobion two times a day", freq: "two times a day", freqPerDay: 2 },
  { line: "Calcium carbonate three times a day", freq: "three times a day", freqPerDay: 3 },
  { line: "Chymoral Forte four times a day", freq: "four times a day", freqPerDay: 4 },
  { line: "Levocetirizine nocte", freq: "nocte", freqPerDay: 1, when: ["NIGHT"] },
  { line: "Montelukast nightly", freq: "nightly", freqPerDay: 1, when: ["NIGHT"] },

  // ── Combination dose+freq and words ─────────────────────────────────────
  { line: "Take Glycomet 500 mg 1-0-1 after food", name: "Glycomet", freq: "1-0-1" },
  { line: "Take Telma 40 once daily", name: "Telma", freq: "once daily" },
  { line: "Apply Betnovate cream BD over rash", name: "Betnovate", form: "cream" },
  { line: "Use Otrivin 2 drops each nostril BD", name: "Otrivin", form: "drops", doseText: "2 drops" },

  // ── Weak/reject edge cases ──────────────────────────────────────────────
  { line: "hello world", reject: true },
  { line: "", reject: true },
  { line: "12345", reject: true },
  { line: "Dr. Rao reviewed the patient", reject: true },
  { line: "Come for review with all reports", reject: true },
  { line: "Urine output adequate", reject: true },
  { line: "7", reject: true },
  { line: "Table", reject: true },
];

describe("sig: parseMedLine table (150+ Indian sig cases)", () => {
  for (const c of CASES) {
    it(`${c.line || "(empty)"}${c.reject ? " → rejected" : ""}`, () => {
      const parsed = parseMedLine(c.line);
      if (c.reject) {
        expect(parsed, `expected "${c.line}" to be rejected`).toBeNull();
        return;
      }
      expect(parsed, `expected "${c.line}" to parse`).not.toBeNull();
      if (!parsed) return;
      if (c.name !== undefined) expect(parsed.med.nameAsWritten).toBe(c.name);
      if (c.name === null) expect(parsed.med.nameAsWritten).not.toBe("");
      if (c.form !== undefined) expect(parsed.med.form).toBe(c.form);
      if (c.strength !== undefined) expect(parsed.med.strength).toBe(c.strength);
      if (c.doseText !== undefined) expect(parsed.med.doseText).toBe(c.doseText);
      if (c.freq !== undefined) expect((parsed.med.frequencyText ?? "").toLowerCase()).toBe(c.freq.toLowerCase());
      if (c.freqPerDay !== undefined) expect(parsed.med.frequency?.frequency).toBe(c.freqPerDay);
      if (c.when !== undefined) expect(parsed.med.frequency?.when).toEqual(c.when);
      if (c.prn !== undefined) expect(parsed.med.frequency?.prn).toBe(c.prn);
      if (c.timing !== undefined) expect(parsed.med.timing).toBe(c.timing);
      if (c.route !== undefined) expect(parsed.med.route).toBe(c.route);
      if (c.duration !== undefined) expect(parsed.med.duration.kind).toBe(c.duration);
      if (c.days !== undefined) expect(parsed.med.duration.days).toBe(c.days);
      if (c.course !== undefined) expect(parsed.med.course).toBe(c.course);
    });
  }
  it("has at least 150 cases", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(150);
  });
});

describe("sig: parseFrequencyToken units", () => {
  it("1-0-1 → morning, midday (skipped), night", () => {
    const f = parseFrequencyToken("1-0-1");
    expect(f?.when).toEqual(["MORN", "NOON", "NIGHT"]);
    expect(f?.slotDoses).toEqual([1, 0, 1]);
    expect(f?.frequency).toBe(2);
  });
  it("QD is flagged error-prone", () => {
    const f = parseFrequencyToken("QD");
    expect(f?.errorProne).toBeTruthy();
  });
  it("slot forms reject plain numbers", () => {
    expect(parseSlotForm("10")).toBeNull();
    expect(parseSlotForm("1-0-1-1-1")).toBeNull();
  });
  it("once a week on Sunday carries the day", () => {
    const f = parseFrequencyToken("once a week on Sunday");
    expect(f?.weeklyDay).toBe("Sunday");
    expect(f?.periodUnit).toBe("wk");
  });
});
