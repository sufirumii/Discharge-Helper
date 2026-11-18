/**
 * Four fully fictional Indian discharge summaries. Raw text only — results
 * always come from the real reading engine at runtime. Invented hospitals,
 * people and phone numbers; the messiness (mixed Tab./Cap prefixes, 1-0-1,
  * OCR-like typos, a look-alike pair, a duplicate paracetamol, a missing
 * duration, a hold line, day-first dates) is deliberate: it exercises every
 * engine path.
 */

export interface SampleCase {
  id: string;
  label: string;
  patient: string;
  facility: string;
  why: string;
  text: string;
}

export const SAMPLES: SampleCase[] = [
  {
    id: "cardiac",
    label: "Heart attack recovery",
    patient: "Rukmani Devi, 64",
    facility: "Lotus Care Multispeciality Hospital, Pune",
    why: "A combination pill, a beta blocker and bedtime medicines after a heart attack",
    text: `Lotus Care Multispeciality Hospital, Pune
Department of Cardiology
Patient: Rukmani Devi, 64 / Female
MRN: LC-2026-88112
Admitted: 02/12/2026
Discharged: 09/12/2026

DIAGNOSIS: Acute inferior wall myocardial infarction. Post primary angioplasty to RCA. Type 2 diabetes mellitus, hypertension.

HOSPITAL COURSE: Patient presented with chest pain for 3 hours. Emergency coronary angiography showed 100% occlusion of RCA, stented with DES. Patient tolerated the procedure well. Echo shows LVEF 45%. During stay blood pressure was difficult to control, hydralazine was required. Itching reaction noted, likely drug rash, hydroxyzine given with relief.

MEDICATIONS ON ADMISSION:
Tab. Telma 40 1-0-0
Tab. Metolar XR 25 1-0-0
Tab. Glycomet 500 1-0-1

DISCHARGE MEDICATIONS:
1. Tab. Ecosprin AV 75/10 1-0-0 after breakfast
2. Tah. Betaloc 25 mg 1-0-1
3. Cap. Atorva 40 mg 0-0-1 (replaced, earlier Atorva 20)
4. Tab. Glycomet 500 mg 1-0-1 continue
5. Tab. Clopilet A 75 mg 1-0-0
6. Tab. Hydroxyzine 10 mg TDS x 5 days for itching
7. Hydralazine 25 mg 1-0-1 x 7 days, then review
8. Tab. Dytor 10 -- hold till cardiology review
9. Syp. Digene 10 ml SOS for acidity

ADVICE: Strict salt restriction. No heavy lifting for 4 weeks. Cardiac rehabilitation to be started after review.

DIET AND ACTIVITY: Low salt diet. Walk 20 minutes daily from next week.

FOLLOW UP: Cardiology OPD review after 7 days on 16/12/2026 at 10 AM with all reports. TMT after one month.

PENDING TESTS: Lipid profile after 4 weeks. HbA1c at review.

WARNING SIGNS: If chest pain or heaviness returns, or breathlessness at rest, go to the emergency department immediately. If palpitations or dizziness occurs, call your doctor.

Discharge prepared by Dr. Meera Krishnan, MD, DM (Cardiology). Phone 99999 00000.`,
  },
  {
    id: "diabetes-insulin",
    label: "Diabetes with new insulin",
    patient: "S. Venkat Rao, 51",
    facility: "Greenfield Medical Centre, Lucknow",
    why: "Insulin injections with units, bedtime dosing and a foot wound",
    text: `Greenfield Medical Centre, Lucknow
Endocrinology
Name: S. Venkat Rao, 51 / Male
UR No: GMC/2026/7742
Date of Admission: 21/11/2026
Date of Discharge: 25/11/2026

DIAGNOSIS: Type 2 diabetes mellitus with uncontrolled sugars, right foot plantar ulcer (Wagner grade 1), diabetic nephropathy stage 2.

HOSPITAL COURSE: Patient admitted with fasting sugars 280-320 mg/dl. Basal insulin started and titrated. Foot ulcer debrided and dressed. Wound culture showed staph aureus, sensitive to amoxicillin. Sugars stabilised with basal-bolus regime during stay. Hypoglycaemia education given.

HOME MEDICATIONS BEFORE ADMISSION:
Tab. Glycomet GP2 1-0-1
Tab. Telma 40 1-0-0
Tab. Rosuvas 10 0-0-1

MEDICATIONS ON DISCHARGE:
1. Inj. Glaritus 20 units SC at bedtime, increase by 2 units every 3rd day if fasting sugar above 140
2. Inj. Human Actrapid 8 units SC before breakfast and 6 units before dinner
3. Tab. Janumet 50/500 1-0-1
4. Cap. Augmentin 625 mg 1-1-1 x 5 days
5. Tab. Zerodol SP 1-0-0 x 3 days after food
6. Tab. Shelcal HD 0-0-1 continue
7. Tab. Rosuvas 10 mg 0-0-1 continue
8. Tab. Pentocid 40 1-0-0 before food
9. Tab. Zincovit 1-0-0
10. Oint. T-Bact apply over wound BD x 7 days

ADVICE: Daily foot inspection. Footwear at all times. Home glucose monitoring: fasting and post dinner. Record all readings in a book and bring to review. Do not walk barefoot.

DIET: Diabetic diet 1600 kcal. Small frequent meals. Avoid sweets and fruit juices.

FOLLOW UP: Diabetes OPD on 2/12/2026 with glucose chart. Dressing alternate day at local clinic till review. Podiatry after 2 weeks.

PENDING TESTS: HbA1c, urine microalbumin, serum creatinine at review. Fundus examination after 1 month.

WARNING SIGNS: If sugar below 70, take 15 g sugar immediately and inform. If wound becomes red, swollen or foul smelling, come to emergency immediately. If vomiting with rapid breathing, go to hospital now.

Dr. A. Siddiqui, DM Endocrinology. Reg No 45XXX.`,
  },
  {
    id: "postop",
    label: "Gallbladder surgery",
    patient: "Mohd. Irfan, 38",
    facility: "Marigold Hospital, Coimbatore",
    why: "Antibiotics and pain medicines after laparoscopic surgery, with two paracetamol medicines",
    text: `MARIGOLD HOSPITAL, COIMBATORE
GENERAL SURGERY WARD
Patient Name: Mohd. Irfan, 38/M
IP No: MH-88-2026-3319
Admitted: 13th Dec
Discharged: 16th Dec 2026

DIAGNOSIS: Acute calculus cholecystitis. Post laparoscopic cholecystectomy (POD 3).

HOSPITAL COURSE: Underwent laparoscopic cholecystectomy on 14/12/2026. Procedure uneventful. Tolerated orals from POD 1. Wound healthy at discharge.

MEDICATIONS AT DISCHARGE:
1. Cap. Monocef O 200 1-0-1 x 5 days
2. Tab. Dolo 650 1-1-1 x 3 days
3. Tab. Combiflam SOS for pain
4. Tab. Pan 40 1-0-0 before food
5. Tab. Cremaffin Plus 15 ml HS x 1 week
6. Syp. Digene gel 10 ml SOS
7. Tab. Ondem 4 mg 1-0-1 x 2 days
8. Tab. Rantac 150 0-0-1
9. Tab. Metrogyl 400 1-1-1 x 5 day
10. Tab. Chymoral Forte 1-1-1 x 5 days

DIET: Start with clear fluids, soft diet tomorrow, normal diet after 3 days. Avoid oily food for 2 weeks.

ACTIVITY: No driving 1 week. No weight above 5 kg for 3 weeks. Walk as tolerated.

WOUND CARE: Keep wounds clean and dry. Dressing not required unless soaked. Stitch removal after 10 days at local clinic.

FOLLOW UP: Surgical OPD after 10 days i.e. 26/12/2026. Histopathology report to collect after 7 days.

WARNING SIGNS: Fever above 100 F, wound redness or discharge, yellow eyes — attend surgical emergency immediately. Persistent vomiting — call the ward.

Discharge by Dr. Priya Raghavan MS. Contact 94400 00000 (ward).`,
  },
  {
    id: "respiratory",
    label: "Asthma with oral steroids",
    patient: "Lakshmi Narayanan, 29",
    facility: "Sunrise Heritage Hospital, Hyderabad",
    why: "An inhaler, a syrup and a reducing steroid course",
    text: `Sunrise Heritage Hospital, Hyderabad
Pulmonology
Patient: Lakshmi Narayanan, 29 / F
Reg No: SHH-PUL-2026-1204
D.O.A.: 07/12/2026
D.O.D.: 10/12/2026

DIAGNOSIS: Acute severe asthma exacerbation. Allergic rhinitis.

HOSPITAL COURSE: Presented with breathlessness and wheeze. Neubilised with duolin and budecort. Intravenous steroids given, shifted to oral prednisolone. Peak flow improved from 180 to 340. Discharged in stable condition.

DISCHARGE MEDICATIONS:
1. Tab. Omnacortil 20 mg 1-0-0 x 3 days, then 10 mg 1-0-0 x 3 days, then 5 mg 1-0-0 x 3 days, then stop
2. Cap. Deriphyllin Retard 150 0-0-1 x 7 days
3. Syp. Ascoril LS 10 ml 1-0-1 x 5 days
4. Tab. Montair LC 0-0-1 x 15 days
5. Foracort 200 rotacap 1 cap inhalation BD via rothaler
6. Tab. Pan-D 1-0-0 before breakfast
7. Tab. Allegra 120 1-0-0 x 10 days
8. Otrivin nasal drops 2 drops each nostril HS x 5 days

ADVICE: Inhaler technique demonstrated, verified with teach back. Avoid dust and cold drinks. Follow up with peak diary.

FOLLOW UP: Pulmonology OPD after 15 days on 25/12/2026. Spirometry at visit.

PENDING TESTS: Serum IgE at review. Absolute eosinophil count.

WARNING SIGNS: If reliever inhaler needed more than 4 times a day, or night attacks, or speech difficulty with breathlessness — come to emergency immediately.

Dr. K. Sreenivas, DNB Pulmonary Medicine.`,
  },
];

export function sampleById(id: string): SampleCase | undefined {
  return SAMPLES.find((s) => s.id === id);
}
