# Reading-engine evaluation

Corpus: 12 synthetic discharge summaries written by the project, each with a hand-written expected result. This is a regression measure, not clinical validation.

## Clean corpus

| case | name recall | name precision | coverage | strength | frequency | duration | course | follow-ups | warnings |
|---|---|---|---|---|---|---|---|---|---|
| case-01 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | ok | ok |
| case-02 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | ok | ok |
| case-03 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | ok | ok |
| case-04 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | ok | ok |
| case-05 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | ok | ok |
| case-06 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | ok | ok |
| case-07 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | ok | ok |
| case-08 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | ok | ok |
| case-09 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | ok | ok |
| case-10 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | ok | ok |
| case-11 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | ok | ok |
| case-12 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | ok | ok |

**Overall (clean):** name recall 100%, name precision 100%, coverage 100%, strength 100%, frequency 100%, duration 100%, course 100%. Follow-up counts matched in 12/12 cases, warning counts in 12/12.

## Noise suite (deterministic distortions of the same corpus)

| noise | name recall | name precision | coverage |
|---|---|---|---|
| case changes | 100% | 100% | 100% |
| extra whitespace | 100% | 100% | 100% |
| OCR-style swaps | 80.2% | 80.2% | 100% |

## Missed medicines (clean corpus)

None.

## Thresholds

coverage ≥ 92% — got 100%
name recall ≥ 90% — got 100%
name precision ≥ 95% — got 100%
strength/frequency/duration/course exact-match ≥ 85% — got 100% / 100% / 100% / 100%

All thresholds pass.

