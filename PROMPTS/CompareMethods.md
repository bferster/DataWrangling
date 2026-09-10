# Prompt: Evaluate three 1870→1880 census linkage outputs against each other and against IPUMS

You are a careful data analyst working on a historical record-linkage project. You have a Python environment with pandas, numpy, scipy, and matplotlib. Your job is to evaluate how well three sets of 1870→1880 census links agree with each other and with an IPUMS reference crosswalk. Work step by step, show your checks, and never silently drop or alter data.

## Context

Each census person is a "mention" identified by a `mention_id` of the form `<COUNTY>-CN-<YEAR>-<line>`, sometimes with a suffix such as `.1` or `.2` when a line number repeated (for example `AUG-CN-1870-191`). The county code in the data is `AUG`. Do not hardcode it; read it from the data.

The census transcriptions originally came from FamilySearch and were later linked to IPUMS records. IPUMS links were built from largely the same transcription base, so transcription errors are shared across all conditions.

## Input files

| File | Fields | Meaning |
|---|---|---|
| `Daniel.csv` | `unique_id_1870`, `unique_id_1880`, `probability` | Method D. Accepted links only. |
| `review.csv` | `source_id`, `target_id`, `probability`, `probability1` | `probability` is method R (same concept as D). `probability1` is RF, the same method with a family boost. Accepted links only. |
| `crosswalk.csv` | `subject_id`, `object_id` (ignore other fields) | IPUMS crosswalk, condition I. Binary links, no probability. |
| `mentions.csv` | many fields | Attributes for every mention. |

Notes on `mentions.csv`: it has a UTF-8 byte-order mark (read with `encoding="utf-8-sig"`) and an unnamed, empty fourth column. For 1870 and 1880 census mentions, `source` is `AUG-CN-1870` or `AUG-CN-1880`; `family_id` is the household grouping (`household_id` is empty); `head` is `t`/`f`. Useful fields: `birth_year`, `gender`, `norm_race`, `norm_first_name`, `nysiis_last_name`, `metaphone_last_name`, `head`, `family_id`.

## Facts about the data that constrain the analysis

1. **Accepted links only.** Daniel.csv and review.csv contain only pairs each method accepted above its own cutoff. There are no scored-and-rejected candidates, so there are no true negatives.
2. **Missing means censored.** A pair absent from a file means "scored below cutoff or never considered." Never impute a missing probability as 0 or any other value.
3. **review.csv row selection used `probability` (R), not `probability1` (RF).** The boost was applied afterward. At the native cutoff, R and RF therefore contain identical links. The boost can only change outcomes at thresholds above the cutoff, or when one 1870 person has multiple targets.
4. **Expected overlap.** Roughly 90% of pairs should appear in both Daniel.csv and review.csv.
5. **IPUMS is a silver standard, not ground truth.** It is high precision but incomplete, and its method uses household information, as the family boost does. A pair IPUMS did not link is not evidence of a method error.

## Conditions

- **D:** Daniel `probability`
- **R:** review `probability`
- **RF:** review `probability1`
- **I:** IPUMS crosswalk (reference)

## Step 1. Load and validate

Standardize every file to columns `id_1870`, `id_1880`, and `p` (RF gets its own `p`). Then check and report:

- Every ID exists in mentions.csv, the 1870 column contains only 1870 census IDs, and the 1880 column contains only 1880 census IDs. Report counts of failures and a few examples.
- Probabilities are numeric and within [0, 1]. Report nulls.
- Duplicate pairs within each file.
- For RF: count rows where `probability1 < probability` and rows where `probability1 > 1`.
- Each condition's minimum probability, as its approximate cutoff.
- Cardinality: 1870 IDs with more than one target, and 1880 IDs claimed by more than one 1870 ID.
- The IPUMS universe: keep crosswalk pairs where both IDs exist in mentions.csv. Report how many were dropped.

If more than 5% of any file's IDs fail validation, stop and report before continuing. For any smaller problem, state the assumption you made and continue.

## Step 2. Coverage and overlap

Build the union of all pairs from D, R, and I, tagged by which conditions contain each pair. Report counts for every membership pattern.

For each 1870 person, compare each pair of conditions and classify the result as **same target**, **different target** (a conflict), or **one side has no link** (an abstention). Keep conflicts and abstentions separate in every table.

## Step 3. Probability agreement among D, R, and RF

On pairs shared by D and R, compute for D vs R and D vs RF:

- Spearman rank correlation
- Mean absolute difference
- Lin's concordance correlation coefficient
- A Bland-Altman plot (difference vs mean)

D and R use the same concept, so they should be nearly identical. List the 25 largest D–R discrepancies with both mentions' names, birth years, and races side by side. Note in the write-up that correlations are depressed by range restriction, because pairs near the cutoffs fall out of one file.

## Step 4. Agreement with IPUMS

For each of D, R, and RF, classify every 1870 person in the IPUMS universe:

- **Agree:** same 1880 target as IPUMS
- **Conflict:** a different 1880 target from IPUMS
- **Miss:** IPUMS linked the person; the method did not
- **Unverifiable:** the method linked the person; IPUMS did not (report, but never count as an error)

Compute:

- Precision vs IPUMS = Agree / (Agree + Conflict)
- Recall vs IPUMS = Agree / (number of IPUMS links in the universe)

Report these at each method's native cutoff, at a shared cutoff (the higher of the D and R cutoffs), and across a threshold sweep from the cutoff to 1.0 in steps of 0.01. Plot truncated precision and recall curves and label them as truncated.

Calibration: bin accepted pairs by probability, using 0.05 bins above the cutoff. In each bin, report the share that agrees with IPUMS, restricted to 1870 people IPUMS linked.

Uncertainty: compute 95% confidence intervals with a cluster bootstrap that resamples 1870 households (`family_id`), not individuals, using 1,000 replicates and a fixed random seed.

Do not compute AUC, ROC curves, or MCC. They require true negatives, which these files do not contain.

## Step 5. Family boost evaluation (R vs RF)

- **Delta test.** Compute delta = RF − R for every review.csv pair. Compare the delta distributions for IPUMS-agree and IPUMS-conflict pairs (medians, a Mann-Whitney U test, and a bootstrap CI on the difference in medians). A useful boost raises agreeing pairs more than conflicting ones.
- **Shared-threshold comparison.** At thresholds 0.5, 0.6, 0.7, 0.8, and 0.9 (keeping only those above the R cutoff), count the agreeing and conflicting pairs each version keeps.
- **Paired test.** At each of those thresholds, score each IPUMS-verifiable pair as a correct decision (kept and agrees, or dropped and conflicts) or an incorrect one, separately for R and RF. Run McNemar's test on the paired outcomes.
- **Flips.** For 1870 IDs with multiple targets in review.csv, check whether the top target changes between R and RF, and whether the change moves toward IPUMS or away from it.
- **Household coherence.** For each condition, find the share of 1870 households whose linked members all land in a single 1880 household. Compare R and RF at the higher thresholds.
- **Error propagation.** List 1870 households where most linked members conflict with IPUMS.
- **Namesakes.** Flag pairs where the source or target household contains another person with the same `norm_first_name` and `nysiis_last_name` (for example, father and son). Report precision vs IPUMS separately for flagged pairs.

## Step 6. Subgroups

Repeat the Step 4 precision and recall, and the Step 5 delta test, by these subgroups:

- `norm_race`
- `gender`
- Age group in 1870: 0–9, 10–19, 20–39, 40–59, 60+ (computed as 1870 − birth_year)
- Head vs non-head
- 1870 household size
- Surname changed (`nysiis_last_name` differs between the 1870 and 1880 mentions)

Report counts with every percentage. Suppress rates for cells with fewer than 20 pairs.

## Step 7. Hand-review samples

Using a fixed random seed, draw up to 40 pairs from each bucket below:

1. D, R, and I all agree
2. D and R agree with each other, but IPUMS differs
3. IPUMS links that no method accepted
4. D and R conflict
5. Pairs with the largest boost that conflict with IPUMS
6. Namesake-flagged pairs

For each bucket, write a CSV showing both mentions side by side (IDs, names, birth years, genders, races, household members' names), plus the IPUMS target where relevant. Add empty columns `reviewer_verdict` (same / different / unsure) and `notes`.

## Deliverables

1. `scorecard.csv`: one row per condition (D, R, RF). Columns: link count, cutoff, coverage, conflict count, abstention count, precision vs IPUMS, recall vs IPUMS, and CIs.
2. `concordance.csv`: pairwise statistics among D, R, and RF.
3. Plots as PNG: Bland-Altman plots, truncated precision/recall curves, calibration bins, and boost-delta distributions.
4. `review_bucket_<n>.csv` files for hand review.
5. `summary.md`: a plain-language write-up with these sections, in order: validation problems found; the headline comparison; whether D and R agree; whether the family boost helps, hurts, or is neutral, with evidence; subgroup findings; and caveats. The caveats must cover accepted-links-only data, IPUMS as a silver standard, shared FamilySearch transcriptions, and the shared household signal between RF and IPUMS.

## Rules

- Do not modify the input files.
- State the denominator for every rate.
- Never describe IPUMS agreement as "accuracy." Call it "agreement with IPUMS."
- If an instruction conflicts with what you find in the data, stop, describe the conflict, and propose an option rather than guessing.

## Lynn's hand matches

- Do not modify the input files.
- State the denominator for every rate.
- Never describe IPUMS agreement as "accuracy." Call it "agreement with IPUMS."
- If an instruction conflicts with what you find in the data, stop, describe the conflict, and propose an option rather than guessing.

## Lynn's hand matches

	I have a fourth file called: lynn.csv
	It is a list of 100 pairs of id's of the same person in the censuses hand-matched by a seasoned genealogist.

	It contains three columns: reviewer_match, source_id and target_id

	A MATCH is a probability of .8 
	UN-MATCHED probability of .3
	MAYBE probability of .6

	Compare lynn's matches with all the other methods