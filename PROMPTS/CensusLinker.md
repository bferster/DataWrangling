# PROMPT: Generate the `CensusLinker` class

You are an expert JavaScript engineer. Generate a complete, production-quality implementation of a record-linkage engine called `CensusLinker`. It links people enumerated in the 1870 US census to the same people in the 1880 US census for one Virginia county, using two in-memory tables (MENTIONS and ASSERTIONS). Its primary output is a list of `isSameAs` assertions, each carrying a calibrated confidence in [0, 0.99].

Read this entire specification before writing code. Every numeric weight, threshold, and rule below is normative unless marked as a default parameter.

---

## 1. Deliverable and constraints

- **Plain vanilla JavaScript (ES2020+), zero external dependencies.** Runs under Node.js. No npm packages, no TypeScript, no build step.
- One file exporting a single facade class `CensusLinker`, internally organized into clearly separated phase components (plain classes or modules within the file): `Preprocessor`, `Blocker`, `PairScorer`, `FamilyAligner`, `Assigner`, `OutputBuilder`. Each must be independently testable via the facade's exposed internals.
- All data fits in memory: ~55,000 census mentions, ~40,000 assertions, and up to a few million candidate pairs after blocking. Use Maps and typed structures for indexes; avoid quadratic scans over the full cross-product (~732M raw pairs — blocking is mandatory).
- **Deterministic**: same inputs → identical outputs, including tie-breaking (break ties by lexicographic mention_id).
- All scoring weights, caps, thresholds, and window sizes live in a single `config` object with the defaults given below, passed to (or defaulted by) the constructor. No magic numbers in logic code.

## 2. Public API

```js
const linker = new CensusLinker(mentions, assertions, config?);
const result = linker.run();
// result = {
//   sameAsAssertions: [...],   // PRIMARY OUTPUT — see §8
//   evidenceBundles:  [...],   // family-alignment evidence, keyed by bundle_id
//   hypotheses:       [...],   // fission/fusion/flag items for human review
//   unmatched1870:    [...],   // mention_ids with no surviving candidate
//   stats:            {...}    // counts per phase, tier distribution
// }
```

`mentions` and `assertions` are arrays of plain objects parsed from CSV (strings; numeric fields may arrive as strings — coerce defensively).

## 3. Input schemas

### MENTIONS (one row per person appearance in a source)

| field | type | notes |
|---|---|---|
| mention_id | string | unique, e.g. `ALB-CN-1870-432` |
| source | string | linkage uses only `ALB-CN-1870` and `ALB-CN-1880`; mortality lookup also reads `ALB-VRD` and `ALB-FG` |
| confidence | float | transcription confidence, 0–0.99 |
| full_name, first_name, middle_name, last_name | string | may be blank; initials occur (e.g. "H.") |
| birth_year | int | ~99.9% populated in both censuses |
| death_year | int | mostly blank in censuses; populated in VRD/FG |
| race | string | e.g. B, W, M(ulatto) |
| gender | string | M / F, may be blank |
| norm_first_name | string | normalized given name (precomputed) |
| nysiis_last_name, soundex_last_name | string | phonetic codes (precomputed — do NOT implement phonetic algorithms) |
| norm_race | string | W / B / blank |
| norm_occupation | string | one of 21 categories, ~60% populated |
| head | boolean-ish | head of household/family |
| household_id | string | **1870 only.** Dwelling grouping. Unreliable at the tail (see §4) |
| family_id | string | populated in BOTH censuses; the family grouping unit |

### ASSERTIONS (RDF-style subject–predicate–object)

| field | type | notes |
|---|---|---|
| assertion_id | string | uuid |
| subject_id, object_id | string | mention_ids |
| predicate | string | isSpouseOf, isChildOf, isParentOf, isSiblingOf, wasEnslavedBy, hasNameVariant, isNotSameAs, isSameAs, etc. |
| start_year, end_year | int | temporal span |
| who | string | asserting source, e.g. `1880Census` |
| confidence | float | 0–1 |

The 1880 census rows come with ~22,000 relation assertions (`who = "1880Census"`) encoding spouse/child/parent links **within** 1880 families. The 1870 census has **no** relation assertions — kin structure must be inferred (§6, Phase 3).

## 4. Hard data facts and defensive rules

1. **family_id is a per-census opaque key.** The ID spaces of 1870 and 1880 are unrelated. NEVER join across censuses on family_id (or household_id). Cross-census correspondence is discovered by scoring only.
2. **1880 has no household_id.** Dwelling/neighborhood context for BOTH censuses is approximated by an **enumeration-sequence adjacency proxy**: extract the numeric line component of `mention_id` (e.g. `432` from `ALB-CN-1870-432`, ignoring any `.n` suffix) as sequence position. Two families are "adjacent" (same-dwelling proxy) if their member sequence ranges fall within `config.adjacencyTight = ±1` family in family order, and "neighbors" within `config.adjacencyWide = ±15` families. Build a per-census ordered family list by minimum member sequence.
3. **1870 household_id is anomalous at the tail** (groups up to 387 people). Ignore any household group larger than `config.maxHouseholdSize = 30` for co-residence evidence; log them in stats. family_id (median size 5 in both censuses) is the trusted unit.
4. Blank fields never trip knockouts. A blank gender, race, or birth_year on either side means that gate/signal simply does not fire.
5. Respect pre-existing `isNotSameAs` assertions: any candidate pair matching one is dropped before scoring, permanently.
6. The adjacency proxy is **soft evidence only** — it may add points, it may never gate or penalize. Families move; absence of neighbors proves nothing.
7. Sequence order may contain page-break noise; the design tolerates this because adjacency is soft.

## 5. Scoring scale (normative)

Scores are additive **log-odds**. Final confidence = `1 / (1 + e^(−score))`, capped at 0.99.

For every scored pair, the class must **emit the full feature vector** (which rung fired on each lever, rarity multipliers, raw contributions) alongside the score. This is required so the hand-set weights can later be replaced by fitted logistic-regression coefficients without any structural change. Weights table = the model; keep it swappable.

### Knockout gates (checked BEFORE scoring; a tripped gate excludes the pair entirely — confidence 0, never "low")

- Gender disagreement (populated M vs populated F only).
- Birth-year gap > 10 years.
- Age regression: 1880 birth_year earlier than 1870 birth_year by more than 2 years.
- Death before 1880: the 1870 mention matches a VRD or FG record (same nysiis_last_name + norm_first_name + birth_year within ±3) with death_year < 1880. Route the same-named 1880 record to a `dualIdentity` hypothesis (likely a Jr.) — do not merge.
- Existing `isNotSameAs` assertion between the pair.

Knockouts live outside the scoring model permanently; a future fitted model must never see them as learnable features.

### Weight table (`config.weights`, defaults)

| Signal | log-odds |
|---|---|
| Intercept (prior for a blocked pair) | −4.0 |
| **Lever A — name cascade** (score the single strongest rung; string and phonetic surname agreement are ONE signal, never double-count) | |
| exact norm_first + surname-match | +4.0 × rarity |
| nickname / Jaro-Winkler ≥ 0.85 first + surname-match | +3.0 × rarity |
| first-initial + surname-match | +2.5 × rarity |
| given-name-only (no surname match) | +1.5 × rarity — POLICY: contributes only if Lever B (±2 or better) or Lever C also fires; otherwise contributes 0 |
| male hard surname mismatch (no exact, no phonetic, no alias, no bridge) | −3.0 |
| female surname mismatch | 0 penalty; drop to given-name-only rung (women's surnames change maiden↔married) |
| **Rarity multiplier** per matched name part, from frequency within the 1870 census pool: | rare (≤ `config.rareCount = 3` occurrences) = 1.5 · typical = 1.0 · common (≥ `config.commonCount = 30`) = 0.5 |
| **Lever B — birth year** exact / ±1 / ±2 / ±3 / ±5 | +2.0 / +1.6 / +1.2 / +0.7 / +0.3 |
| gap 6–10 years | −1.0 |
| **Race** norm_race agree / soft conflict (B or M vs W) | +0.5 / −1.5 |
| **Occupation** norm_occupation match (both adults, both populated) | +0.4 |
| **Lever C — family alignment** (Phase 3): spouse aligned / each other aligned member | +1.2 / +0.6, total cap +2.4 |
| **Lever D — neighborhood persistence**: each OTHER matched pair whose members fall within the wide adjacency window on both sides | +0.3, cap +0.6 |

"Surname-match" fires on any ONE of: exact last_name; nysiis or soundex equality; a `hasNameVariant` alias assertion; a bridge assertion (isSpouseOf / marriage record) connecting the two surnames. **v1 stubs the marriage bridge**: implement the check as a lookup into an injected `config.surnameBridges` map (default empty), with the interface documented, so VRM-derived bridges can be supplied later.

Nickname equivalence uses an injected `config.nicknameTable` (map of norm_first_name → canonical), default provided with common 19th-century pairs (Sallie/Sarah, Bettie/Elizabeth, Polly/Mary, Fannie/Frances, Puss→null-wildcard is NOT included — do not invent wildcards). Implement Jaro-Winkler yourself (it is short); do not implement NYSIIS/Soundex (precomputed).

### Tiers (policy layer, applied after confidence)

- **Tier 1**: confidence ≥ 0.98 AND at least two independent levers fired (A, B, C, D count separately; race/occupation do not qualify as levers). Single-lever pairs can never be Tier 1 regardless of score.
- **Tier 2**: 0.75 ≤ confidence < 0.98, or ≥ 0.98 on one lever → emitted, flagged `review: true`.
- **Tier 3**: below 0.75 → not emitted as assertions; counted in stats.

## 6. Pipeline phases

### Phase 0 — Preprocess
Split census mentions into 1870 and 1880 sets. Build indexes: by nysiis_last_name, by norm_first_name, by family_id; name-frequency tables (surname and given name, per census) for rarity; the mortality index from VRD/FG; the family sequence order for adjacency; the 1880 kin-edge map from relation assertions. Infer 1870 kin edges heuristically (head + opposite-gender adult within ~15 years = probable spouse; members ≥13 years younger than head = probable children), tagging them `inferred: true` with confidence 0.5 — inferred edges may influence alignment ordering but never veto an alignment and never fire generational flags on their own.

### Phase 1 — Blocking (union of three passes)
1. Phonetic surname pass: nysiis OR soundex equality + same/blank gender + birth_year within ±12.
2. Given-name pass: norm_first_name equality (or nickname-table equivalence) + same/blank gender + birth_year within ±5 — surname ignored. (This recovers married women and post-emancipation surname adoption.)
3. Household-anchored pass: for every pair surviving passes 1–2, add all cross-products of the two families' *unmatched* members as candidates (this is how nickname-flip children get a chance).
Deduplicate pairs across passes; record which passes generated each pair.

### Phase 2 — Pairwise scoring
Apply knockouts, then the weight table (Levers A, B, race, occupation). Store score, feature vector, and provisional confidence per pair.

### Phase 3 — Family graph alignment
Candidate family pairs = every (1870 family, 1880 family) sharing ≥1 surviving scored pair; head-to-head pairs are strongest seeds.
For each candidate family pair, solve a small bipartite assignment (families have median 5, max ≤ ~43 members — a greedy-with-swaps or Hungarian on tiny matrices is fine) maximizing summed pairwise scores, subject to: gender knockouts absolute; role consistency soft (1880 relation edges are constraints, inferred 1870 edges are hints).
Rules:
- **Arrivals free**: 1880 members born after 1870, and married-in spouses, are unpenalized.
- **Departures free**: unmatched 1870 members are neutral (mildly confirming if the mortality index explains them).
- **Block surname drift**: if ≥ `config.driftQuorum = 3` aligned members share the same 1870-surname→1880-surname shift, treat surname agreement as satisfied for ALL aligned members at the drift rung, counted as ONE surname signal for the family (do not multiply rarity across members).
- **Generational plausibility flag**: any 1880 parent–child relation edge implying a parent age at birth outside 13–60 → emit a `generationalFlag` hypothesis; do not block the alignment.
- **Fission**: an 1870 family's members may align into MULTIPLE 1880 families (individuals stay strictly one-to-one). When an aligned 1880 head aged 20–35 (in 1880) matches a non-head 1870 member, emit a `fission` hypothesis linking parent family → fragment family. Fission links are hypotheses ONLY — never auto-assert isChildOf.
- **Fusion**: an aligned 1870 head appearing as a non-head (parent relation) in an 1880 family, or aligned into a tight-adjacent family → `fusion` hypothesis.
Propagation: exactly **two rounds**. Round 1: alignments from Phase 2 scores. Round 2: redistribute Lever C (and compute Lever D) bonuses onto member pairs and re-solve alignments once. **Feedback guard (non-negotiable)**: a pair's Lever C/D bonus derives only from OTHER pairs' evidence, never its own. Do not iterate further.

### Phase 4 — Global one-to-one assignment
Each mention matches at most one mention across censuses. Resolve collisions household-first (a candidate embedded in a strong family alignment beats a slightly higher-scoring isolate — precedence when alignment score ≥ `config.alignmentPrecedence = 1.2`), then greedy by confidence, ties by mention_id. Every displaced runner-up above Tier 3 is recorded in stats and, if within 0.05 confidence of the winner, emitted as a `collision` hypothesis.

### Phase 5 — Output
Build the result object (§8). Recompute final confidence from the full feature vector after Phase 3 bonuses.

## 7. Architecture requirements

- Weight table, thresholds, windows: all in `config`, documented defaults, overridable.
- Feature vector per emitted pair is mandatory (future logistic-regression fit swaps the weight table only).
- Evidence trail: every isSameAs assertion must be reconstructible — which levers fired, which kin pairs backed Lever C (with their mention_ids and assertion_ids), which neighbors backed Lever D.
- Clear JSDoc on the facade and each phase component. No console output except an optional injected logger.

## 8. Output contracts

### sameAsAssertions (PRIMARY) — one row per Tier 1/Tier 2 link, shaped for the ASSERTIONS table:
```js
{
  assertion_id: "<uuid v4>",
  subject_id:  "<1870 mention_id>",
  predicate:   "isSameAs",
  object_id:   "<1880 mention_id>",
  start_year:  1870,
  end_year:    1880,
  who:         "CensusLinker-v1",
  confidence:  0.983,                // the calibrated probability, ≤ 0.99
  created:     "<ISO timestamp>",
  // extension fields (kept outside the core columns):
  tier: 1,
  review: false,
  features: { leverA: {...}, leverB: {...}, leverC: {...}, leverD: {...}, race: ..., occupation: ..., rarity: {...} },
  evidence_bundle_id: "<id or null>"
}
```

### evidenceBundles: `{ bundle_id, family_1870, family_1880, memberAlignment: [{m1870, m1880, backing: [assertion_ids/mention_ids]}], surnameDrift: {from, to} | null, alignmentScore }`

### hypotheses: `{ hypothesis_id, type: "fission"|"fusion"|"dualIdentity"|"generationalFlag"|"collision", subjects: [...], narrative: "<one human-readable sentence>", relatedBundle: id|null }`

## 9. Acceptance tests (encode as runnable assertions in a `selfTest()` method over injected fixture data; construct minimal fixtures reproducing each situation)

1. **Name-drift + spouse**: "H. Gains" (1870, b.~1795, wife Agnes b.~1810, children James/Louisa/Victoria) vs "Henderson Goings" (1880, b.~1796, wife Agnes, different co-residents) → must link at **Tier 1 (confidence ≥ 0.98)** with Lever A firing on first-initial-or-better + phonetic surname, and Lever C spouse alignment.
2. **Fission**: James (1870 child, b.1850) vs James Goings (1880 head, b.~1850, wife Fannie, children Lina/William) → individual match emitted AND a `fission` hypothesis linking the 1870 parent family to the new 1880 family. No isChildOf assertion is written.
3. **Generational flag**: 1880 family where "son" John (b.1870) has head b.1796 → `generationalFlag` hypothesis fires (boolean presence, not a confidence test); the family alignment itself still proceeds.
4. **Common-name restraint**: three same-named candidates ("Henry Goings" b.~1849) with no family corroboration → **none exceeds Tier 2**; all confidences < 0.98.
5. **Knockouts**: an M/F pair, a >10-year birth-gap pair, and a pair whose 1870 side has a VRD death_year 1877 → all excluded with confidence 0 (not merely low); the death case emits a `dualIdentity` hypothesis.
6. **Female surname change**: 1870 daughter (b.1852, surname X) vs 1880 wife (b.1852, surname Y) with matching rare given name and a strong family/neighbor corroborator → survives blocking via the given-name pass and reaches ≥ Tier 2; with no corroborator, contributes 0 and stays Tier 3.
7. **One-to-one**: two 1880 records tie for one 1870 record → exactly one isSameAs emitted; the loser appears as a `collision` hypothesis when within 0.05.
8. **Determinism**: two runs over the same fixtures produce byte-identical output (excluding uuids/timestamps — make both injectable for tests).

Tests assert decisions and confidence BANDS (tier membership, flags emitted), never exact scores, so weight tuning does not break them.

## 10. Do NOT

- Do not use any npm package, TypeScript syntax, or Node built-ins beyond `crypto.randomUUID` (make uuid/clock injectable).
- Do not join across censuses on family_id/household_id.
- Do not let any positive evidence override a knockout, ever.
- Do not force a match for every 1870 record — unmatched is a correct outcome.
- Do not implement NYSIIS/Soundex (precomputed) or invent nickname equivalences beyond the injected table.
- Do not iterate propagation beyond two rounds, and never let a pair's own score feed its own Lever C/D bonus.
- Do not auto-assert kin relationships (isChildOf etc.) from fission/fusion findings — hypotheses only.

Produce the complete single-file implementation, followed by a brief usage example showing construction from parsed CSV arrays and a call to `run()` and `selfTest()`.
