/**
 * statistics — the SINGLE source of every external statistic the product
 * quotes (README, "Why this matters" panel). India evidence leads; the US
 * studies follow.
 *
 * Verification is honest: each entry was fetched at its live URL in the build
 * environment and the exact sentence confirmed, or it says so plainly. None
 * are invented, none broader than the cited study. Every entry carries
 * dataYear so no claim can be misread as current-year data.
 */

export interface Statistic {
  id: string;
  claim: string;
  source: string;
  sourceUrl: string;
  /** Honest verification label shown in small print. */
  status: "verified-at-url" | "kept-from-project-research-not-re-verified-in-this-build";
  dataYear: string;
  display: string;
}

export const STATISTICS: Statistic[] = [
  {
    id: "india-jipmer-handwritten",
    claim:
      "At JIPMER, Puducherry, handwritten discharge prescriptions carried 5.5 times the odds of prescribing errors compared with electronic ones (OR 5.5, 95% CI 4.6–6.1), and introducing an electronic discharge prescription system cut prescribing errors by 75%.",
    source: "Yugandhar et al., Journal of Young Pharmacists 2017;9(3):441 (JIPMER, Puducherry)",
    sourceUrl: "https://jyoungpharm.org/article/9/3/441",
    status: "verified-at-url",
    dataYear: "2017 study",
    display:
      "At JIPMER, Puducherry, handwritten discharge prescriptions carried 5.5 times the odds of prescribing errors, and an electronic discharge prescription system cut those errors by 75%.",
  },
  {
    id: "india-generics-share",
    claim:
      "Generic medicines account for only about 4–5% of India's ₹1.4 lakh crore pharmaceutical market; patients mostly buy exactly what is written on the prescription, according to the president of the Retail and Dispensing Chemist Association.",
    source: "Free Press Journal (2026), quoting the Retail and Dispensing Chemist Association",
    sourceUrl:
      "https://www.freepressjournal.in/mumbai/generic-medicines-in-india-government-push-faces-doctor-resistance-quality-concerns-a-thriving-branded-generic-market",
    status: "verified-at-url",
    dataYear: "2026 report",
    display:
      "Generics are only about 4–5% of India's ₹1.4 lakh crore medicine market — patients mostly buy exactly what is written, rarely questioning it.",
  },
  {
    id: "med-errors-kripalani",
    claim:
      "In a randomized trial of 851 adults hospitalized with acute coronary syndromes or heart failure at two academic hospitals, 50.8% had at least one clinically important medication error within 30 days of discharge; 22.9% of those errors were judged serious and 1.8% life-threatening.",
    source: "Kripalani et al., Annals of Internal Medicine 2012;157:1-10",
    sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3575734",
    status: "verified-at-url",
    dataYear: "2012 study",
    display:
      "In a randomized trial of 851 adults hospitalized with acute coronary syndromes or heart failure, 50.8% had at least one clinically important medication error within 30 days of discharge; 22.9% of those errors were judged serious and 1.8% life-threatening.",
  },
  {
    id: "vanderbilt-heart",
    claim:
      "In a Vanderbilt cohort of 471 heart patients, 59.2% (279) misunderstood the indication, dose or frequency of a cardiac medication.",
    source: "Mixon et al., Mayo Clinic Proceedings 2014;89(8):1042-1051",
    sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/24998906/",
    status: "kept-from-project-research-not-re-verified-in-this-build",
    dataYear: "2014 study",
    display:
      "In a Vanderbilt cohort of 471 heart patients, 59.2% (279) misunderstood the indication, dose or frequency of a cardiac medication.",
  },
  {
    id: "understood-instructions",
    claim:
      "Federal data show fewer than half of hospital patients say they confidently understood how to care for themselves after discharge (reported by KFF Health News, 2016).",
    source: "Federal data, reported by KFF Health News (2016)",
    sourceUrl:
      "https://kffhealthnews.org/aging/home-health-agencies-often-miss-medication-errors-endangering-patients/",
    status: "verified-at-url",
    dataYear: "2016 report",
    display:
      "Federal data show fewer than half of hospital patients say they confidently understood how to care for themselves after discharge (2016).",
  },
  {
    id: "health-literacy-third",
    claim:
      "About one-third of US adults lacked the health literacy to understand common medication instructions (2003 national assessment data, cited in a 2008 review by Cua and Kripalani).",
    source: "2003 national assessment data, cited in a 2008 review by Cua and Kripalani",
    sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3575742",
    status: "verified-at-url",
    dataYear: "2003 data (cited 2008)",
    display:
      "About one-third of US adults lacked the health literacy to understand common medication instructions (2003 national assessment data, cited in a 2008 review).",
  },
];

/** The always-visible emergency line. 112 is India's national emergency
 *  number, verified at the Ministry of Home Affairs ERSS page. */
export const EMERGENCY_NOTE =
  "In an emergency, call 112 right away — this app is not a substitute for your care team.";

/** India's national emergency number, verified at the Ministry of Home Affairs
 *  Emergency Response Support System page. */
export const EMERGENCY_112 = {
  number: "112",
  source: "Ministry of Home Affairs, Emergency Response Support System",
  sourceUrl: "https://www.mha.gov.in/en/divisionofmha/erss-0",
};

/** Methods this product is built on (AHRQ). */
export const METHOD_SOURCES = [
  {
    id: "teach-back",
    name: "Teach-back method",
    url: "https://www.ahrq.gov/health-literacy/improve/precautions/tool5.html",
  },
  {
    id: "brown-bag",
    name: "Brown-bag medicine review",
    url: "https://www.ahrq.gov/evidencenow/tools/health-literacy.html",
  },
];
