**LINK CENSUS TO CENSUS**

	I want to create a list of matched people between a verified persons list and a census for the current county and record_year. 

	county variable holds current county.
	record_year variable holds the record’s year.
	Save as a CSV file using papaparse when done for HITL verification.

*Code*

	Make a one-page app called: census2census.htm.
	Use plain vanilla JavaScript. 
	Use jquery and papaparse libraries.

	Add a text input to set the county. Default to “AUG”.
	Add a pulldown to select between 1860, 1870, 1880, and 1900. 

	Raw data exists in a CSV file called mentions.csv in the /COMMON folder.
	Use the methods in match.js in the /COMMON folder.

*Person list*

The people list contains a list of verified people from the census and contains the following data fields {

	- person_id - A unique identifier for the row (i.e. AUG-VP-1234)
	- confidence - The confidence of the mention: 0-1
	- full_name - The full name of the person
	- first_name - The first name of the person
	- middle_name - The middle name of the person
	- last_name - The last name of the person
	- birth_year - The birth year of the person (may be a range)
	- death_year - The death year of the person (i.e. 1820-1880)
	- race - The race of the person 
	- gender - The gender of the person
	- occupation - The occupation of the person
	- norm_first_name - The normalized first name of the person
	- nysiis_last_name - The NYSIIS encoded last name of the person
	- metaphone_last_name - The metaphone of last name of the person
	- norm_race - The normalized race of the person: B/W
	- norm_occupation - The normalized occupation of the person
	- mentions [] - Array of mention_ids
	- enslaver - TRUE/FALSE 
}

	It was initially populated from the census. 
	The goal of this step is to match the persons in the verified list with new unique people from the census. 

	If they are truly new people, they need to be included in the verified list. If they are the same people 10 years later, their mention_id needs to be added to the verified list’s mention array.

*Load lists*

	- Data is loaded from mentions.csv.
	- Add a pull down menu to select source, labeled "SOURCE":
		- 1850
		- 1860
		- 1870
		- 1880 
		- 1900
	- Add a pull down menu to select census to match to, labeled "TARGET":
		- 1860
		- 1870
		- 1880 
		- 1900
	- When clicking "Run Matcher", filter mentions.csv for the selected SOURCE record year (e.g. AUG-CN-1850) and match against the selected CENSUS record year (e.g. AUG-CN-1860).
	- Don't start matching at startup, or when changing sources.

*Household grouping (hhKey)*

	Household rosters drive Lever C, so grouping must not silently fail.

	- 1850 and 1860 populate household_id.
	- 1870 and 1880 populate ONLY family_id (household_id is empty).
	- Therefore group with hhKey(record) = household_id || family_id.
	- Without this fallback Lever C scores zero for every 1870/1880 pass —
	  exactly the censuses where kin evidence is strongest.

*Candidate retrieval (blocking index)*

	Build an index over the target census with these keys {
		L  - last_name
		N  - nysiis_last_name
		F  - full_name
		M  - metaphone_last_name (both primary and secondary codes)
		FB - norm_first_name + 5-year birth bucket
		}

	The FB key is required. All the other keys are surname-based, so a woman
	whose surname changed at marriage has NO key in common with her earlier
	record and is never retrieved — she is not scored badly, she is not scored
	at all. FB is the only retrieval path that survives a surname change.

	Retrieval is capped at MAX_CANDIDATES (800) per person per round.

*Find matches*

	Set floor and ceiling thresholds.
	Handle year range  comparisons implicitly.
	Block on race, gender, birth_year, and death_year {
		Ignore when _raceClass is different (B and M collapse to one class;
			routine Black/Mulatto reclassification must not veto a match).
		Ignore when gender is different.
		Ignore if  birth_year is more than 12 years apart and either are not NULL
			(aligned with the MatchPerson birth-profile knockout).
		Ignore if verified death_year is before the target census year and
			either are not NULL.
		}
	For each row in verified, find the matching row in census {
		Use MatchPerson() from the  method to find matches, factoring the name, birth_year, and death_year values. It also scores for common family members. 
		Save match score in score field.
		Save probability in probability field.
		Why - details on the scoring.
		If the score is below floor, set status as "UN-MATCHED".
		Else if score is above ceiling, set status as “MATCH”,
		Else set status as “MAYBE”.
		}

	Tunables passed to MatchPerson() {
		householdBoost (BETA): 0.6      // noisy-OR residual-gap boost
		birthProfiles: CENSUS_CENSUS { sigma 3.0, knockout 12 }
		               SCHEDULE_INVOLVED { sigma 3.5, knockout 12 }
		weights: { name: 0.40, birth: 0.30 }
		}

**MULTI-PASS CASCADE**

	Add a checkbox labeled "MultiPass", DEFAULT CHECKED.
		- Checked   -> run the round cascade below.
		- Unchecked -> single round, original behavior.

	Rationale: matching in one pass scores every person against a static index.
	Each confirmed match is itself evidence — it tells you where a family landed —
	so running in rounds lets later rounds use what earlier rounds established.

*Round definitions*

	Each round has: ceiling, minLevers (fired levers required), margin (best minus
	runner-up), and whether it may use bridges / first-name retrieval.

	R0  HITL          - re-apply confirmed claims from a loaded HITL CSV.
	R1  Anchors       - ceiling max(ceiling, 0.90), minLevers 3, margin 0.05.
	                    No bridges, no first-name. Near-certain matches only.
	R2  Bridges       - ceiling, minLevers 2, margin 0.05. Bridges on.
	R3  Surname change- ceiling, minLevers 1, margin 0.05. Bridges + first-name.
	R4  Residual      - promoteFloor, minLevers 1, margin 0.10. Both on.
	Slack             - final sweep: best remaining candidate above floor.
	                    Never forces a sub-floor claim.

*Household bridges*

	After every round, rebuild a map of where each source household landed:
		sourceHouseholdKey -> targetHouseholdKey  (majority vote over assignments)

	In rounds with bridges enabled, seed candidates from the whole target
	household the person's family landed in, REGARDLESS of surname. This
	recovers bad surname transcriptions and disambiguates common names against
	a known family.

	Honest limit: a bridge does NOT directly find a married daughter, because
	she is no longer in her parents' household. She is found by FB retrieval;
	the bridge helps corroborate once she is retrieved.

*Claim-once ledger*

	- A target mention claimed in an earlier round is removed from every later
	  round's candidate pool. This is what enforces one-to-one assignment.
	- A pair already scored is not re-scored in a later round.
	- Rounds lock only their own confident, clear, uncontested winners.

*Performance gate*

	The FB (first-name) net is the dominant cost of the cascade. Skip it for any
	person who already has a candidate scoring at or above floor from an earlier
	round. Measured effect: ~3x faster with minimal coverage loss.

*Reconcile*

	If two or more persons claim the same census row as MATCH, keep the highest-scoring claim as MATCH and demote the others to MAYBE. When a person's top two census candidates are within a small margin, force MAYBE rather than MATCH.

	In the cascade this is enforced structurally: rounds are ordered strongest-
	claim-first, and the claim-once ledger prevents a mention being taken twice.

*Cross-run persistence (HITL ledger)*

	When a HITL CSV is loaded, its decisions persist into the next run {
		reviewer_status = MATCHED    -> pre-lock the pair in R0; never re-litigated.
		reviewer_status = UN-MATCHED -> never-match; the pair is excluded from
		                                every round, so a rejected pair is never
		                                shown to a reviewer twice.
		}

*Calibration*

	IMPORTANT — feature vector must match match.js exactly.

	match.js _calibFeatures uses FOUR features, in this order:
		[ name, birth, family (H), surnameReliability ]

	Build labeled rows with all four. Building three causes probability() to
	throw "feature length 4 != 3", which is swallowed by a try/catch — the
	calibration appears to succeed while silently doing nothing.

	- Fit once per run with fitCalibration() on resolved labels
	  ({county}-LABELS.csv: person_id, mention_id, label 0/1).
	- Predict with probability(); recompute every edge after fitting.
	- Fall back to nameProbability() (fitNameCalibration) only if the full
	  calibrator is unavailable, then to the raw score.
	- Re-fit per census pass; a curve learned on 1850->1860 does not transfer
	  unchanged to 1870->1880.

*Save as CSV for human review*

	Save the following columns from the census list  {

		Show only these fields and in this order {
			reviewer_status	verity_status	matched_in_round	probability	source_id	target_id	source_full_name	target_full_name	why	source_first_name	source_middle_name	source_last_name	source_birth_year	source_death_year	source_race	source_gender	source_occupation	source_legal_status	source_norm_first_name	source_head	source_household_id	source_family_id	source_birth_place	source_enumeration	source_district	target_first_name	target_middle_name	target_last_name	target_birth_year	target_death_year	target_race	target_gender	target_occupation	target_legal_status	target_head	target_household_id	target_family_id	target_birth_place	target_enumeration	target_district
		}

		Show which household members corroborated:
			family: (i.e. Samuel Lightner-1817, Lucy-1823)

	How to make the why field {
		Break the score into its levers using matchNameDetail() {
			name: (i.e. 1.0)
			birth: (i.e. .6)
			family: (i.e. .9)			// this is H, the noisy-OR household support
			rung: (i.e. EXACT_FIRST_SUR)
			surnameKind: (i.e. EXACT_LASTNAME)
			surnameReliability: (i.e. 1.0)
			needsCorroboration: (i.e. TRUE)
			birthGap: (i.e. 1)
			margin: (i.e. .12)  secondBest: (i.e. .58)
			round: (i.e. R2 Bridges)	// which round locked the match
		}
		
		Show which household members corroborated:
			family: (i.e. Samuel Lightner-1817, Lucy-1823)
		

	Save table to disc as “review.csv” 

**Review view mode**

	- Add a new button to the results display control called "Review"
	- If that is active, hide the status. score, why, and probability columns, otherwise show them.
	- Add a pulldown to set HITL review mode to select "-" "MATCHED", "MAYBE", "UNMATCHED". (store in hitl_match field in output csv)
	- Show "Matched In Round" in the Why breakdown drawer.
	- Add checkbox for "Sample" to show 500 sampled rows using Neyman Allocation:

		1. Stratify. It slices the candidates into 8 bins by match_probability, and — this is the clever part — it sets the bin boundaries to be exactly the thresholds you'd ever want to evaluate (0.10, 0.25, 0.50, 0.75, 0.90, 0.95, 0.99). Bin H is the 0.01–0.10 junk band; bin A is the 0.99+ near-certain band.

		2. Allocate. It decides how many of the 300-pair budget to draw from each bin using Neyman allocation — sample more where the population is large and where the match rate is near 50% (most uncertain), fewer where it's lopsided. It uses each bin's mean posterior (pbar) as a stand-in for the true match rate, and enforces a floor of 35 per bin so no stratum is starved. Result: roughly 40–50 per bin.
		3. Draw. Simple random sample within each bin, shuffle them together, and write two files: one with scores for you, and one without scores — just the two IDs and a blank label column — so the reviewer can't be anchored by what the model already thinks.

		4. Estimate. Once labels come back (matched / unmatch / maybe), it estimates the true match rate in each bin from your ~40 reviews, scales it up by the bin's full population size, and — because the bin edges are the thresholds — every threshold's precision and recall falls out as a clean ratio of stratified totals. It adds bootstrap confidence intervals and a deterministic "ignorance band" from the unsure labels. The last cell is a smoke test with a fake reviewer.

