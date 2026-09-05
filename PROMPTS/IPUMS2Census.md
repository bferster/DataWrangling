
**TASK: Match IPUMS records to census transcription**

	I have 2 CSV files: my full transcription of the census for a given year, and a data file that contains much of the same information as a file from IPUMS. I want to add some fields from IPUMS to my canonical census file.

*Inputs*

	census.csv — full transcription of the census for a given year (source of truth; row count and row order must not change)
	ipums.csv — corresponding IPUMS extract for the same year. Gender matches census.csv's scheme exactly. Race does NOT match 1:1: ipums.csv's norm_race collapses Mulatto ("M") into Black ("B"), giving only B/W/I, while census.csv keeps M as a distinct code (B/M/W). Treat this as an intentional, documented bucketing, not a bug to route around.

*Output columns to add/update in census.csv*
	
	ipums_id 
	prop_value — only if this is the 1850, 1860, or 1870 file.
	relation — update/populate from IPUMS for 1850, 1860, and 1870 files; do NOT update or overwrite for 1880 on.
	ipums_match
Do not add, remove, or reorder rows in census.csv. Every existing row and column stays as-is (NEVER update or overwrite the head column in census.csv); only new columns are appended or permitted fields updated.

*Step 1 — Group both files into family units (NOT dwelling/household)*

	- Structural unit definition:
		- In census.csv, group rows on family_id (or family field — consecutive family groups within district), NOT on household_id or dwelling.
		- In 1860, there are 3,406 family units with exactly one head each.
		- In ipums.csv, group rows by SERIAL (IPUMS assigns SERIAL to family units in enumeration order).
		- Match census family_id against IPUMS SERIAL.
		- Multi-family dwelling caveat: Historical censuses frequently have multiple families/heads sharing a single dwelling (household_id). For example, 1850 has 1.83 heads per household_id, and 1860 exhibits similar clustering. Grouping on household_id conflates multi-family dwellings into artificially large blocks, causing catastrophic mismatch against IPUMS SERIAL.
		- Signal strength: The underlying signal is exceptionally strong — 97.7% of 1860 households have a globally unique (birth_year, gender, race) signature, and only 77 units in the entire county are ambiguous. A low match rate points to a structural mismatch (household vs. family), not weak evidence.
		- Separate dwelling layer: Extract DWELLING and DWSEQ from IPUMS to reconstruct the dwelling/household layer separately if desired, without distorting family-level matching.
	- Group Quarters / Institutions: 
		- Merge consecutive rows with relate="Group" into a single continuous institutional household block rather than isolated 1-person records.
		- In historical censuses where IPUMS indexed large boarding schools, seminaries, or asylums as consecutive 1-person family units (relate="Self") while census.csv grouped them under a single family ID, identify these as institutional candidate blocks.
	- Parse infant/fractional ages: Convert Excel date formats (e.g., "12-Jan", "12-Jun"), fractions ("6/12"), and values <= 1.0 to infant age 0.
	- Each group becomes a family unit record: the ordered list of its members’ (age, gender, race, birthplace-if-present).

*Step 2 — Match family units to IPUMS SERIAL units*

	- Use enumeration order as a prior, not just field similarity:
		- Both files preserve original manuscript sequence — IPUMS assigns SERIAL in strict enumeration order, and census.csv line numbers run in the exact same sequence.
		- Score candidates by positional proximity to already-anchored neighbours: use an anchor-and-interpolate approach (the same method used on slave schedules). Confident matches serve as spatial anchors; candidate IPUMS units for intervening census families are strongly expected to lie between those bounding anchors.
	- Pass 1 (Standard Mutual Matching with Positional Prior): 
		- For each census family unit, score it against candidate IPUMS SERIAL units using: family size (exact or ±2), multiset similarity of member ages (within ±2 years) combined with exact gender and 3-way race match, boosted and constrained by positional proximity to nearby established anchors.
		- A family match is accepted in Pass 1 if it clears the confidence threshold and is a mutual best match (the single best IPUMS candidate for that census family, and vice versa). These accepted matches become fixed anchors.
	- Pass 2 (Continuation Merging for Split Families): 
		- For remaining unmatched census units, test merging consecutive adjacent census units where the continuation unit lacks an independent head or represents an over-split family. If the combined unit matches a single IPUMS SERIAL unit with >= 70% confidence within the local positional window, accept the merged match.
	- Pass 3 (Institutional Blocks > 15 members): 
		- Where an institution was fragmented by IPUMS into multiple single-person units, anchor on the facility lead/head demographics and evaluate contiguous sequential register alignment or facility pool demographic matching across consecutive IPUMS records.
	- Relax the all-or-nothing household rule:
		- Previously, failing the household-level threshold discarded every member of that unit. With ~6.6 people per household, each household-level failure discards six or seven valid person matches.
		- When a family-level match is a near-miss or falls below the mutual threshold, do NOT discard all its members.
		- Instead, pass these near-miss/unmatched units to Step 3b for person-level fallback matching within a bounded positional window.

*Step 3 — Match people within matched units & fallback*

	Step 3a — 1-to-1 matching within confirmed family units:
		- Within an anchored family pair, match census rows to ipums rows one-to-one:
			- Gender: must match exactly. No exceptions, no fuzzy handling.
			- Race: must match exactly on a shared 3-way bucket — collapse census.csv's "M" into "B" before comparing, then require an exact match against ipums.csv's norm_race (B / W / I). This means a census row originally coded M can match an ipums row coded B, and vice versa. No other race substitutions are allowed.
			- Birth_year / Age: compare with a stated tolerance (e.g. ±2 years); score closer ages higher.
			- If age column contains fractional/date infant ages, match on infant age 0.
			- For Group Quarters and Institutional facilities (e.g., Asylums, Boarding Schools): match individuals by demographic signature from the facility pool in original manuscript register order.
		- Enforce one-to-one uniqueness within the household: where multiple census rows tie for the same best ipums row (e.g. two same-age, same-gender, same-race siblings), leave all tied rows unmatched rather than guessing an order, and record a flag in the ipums_match column (e.g. "TIE").
		- If no ipums person in the matched household clears a minimum person-level confidence threshold, leave that row unmatched.

	Step 3b — Person-level fallback for near-miss family units within positional window:
		- For census family units that failed full household matching (near-misses below threshold, slight composition differences, or single missing/extra members):
		- Define a candidate positional window in IPUMS bounded by the nearest preceding and following confirmed anchors.
		- Within this window, match census individuals to available IPUMS persons using individual demographic signatures (exact gender, 3-way race match, age within ±2 years).
		- Enforce 1-to-1 uniqueness: an IPUMS record already claimed by an anchored family or another person cannot be reused.
		- Record successful fallback matches in ipums_match (recording confidence score and fallback indicator) while leaving genuine non-matches blank.

*Step 4 — Populate output*

	- For every uniquely and confidently matched person (from Step 3a or Step 3b), copy ipums_id, prop_value (if 1850, 1860, or 1870), and relation (if 1850, 1860, or 1870), along with ipums_match score.
	- For 1880 and later census files, do NOT update or overwrite the existing relation field.
	- NEVER update or overwrite the head column in census.csv for any census year.
	- For every unmatched row that cannot be confidently resolved (or ties), leave ipums_id and prop_value blank (and record "TIE" or blank in ipums_match). Do not force a low-confidence guess into the output.


// RUN SCRIPT FROM BASH: python match_ipums.py
 //
**Getting data from IPUMS**

	*Data to get*

		- age: ipums gives age as "AGE" in whole years
		- gender: ipums gives gender as "SEX" with 1 = Male and 2 = Female
		- birth_year: ipums gives birth year as "BIRTHYR" in whole years
		- race: ipums gives detailed race as "RACED"
		- relate: ipums gives detailed relationship as "RELATED"
		- birth_place: ipums gives birthplace as "BPL"
		- ipums_id: ipums gives as "HISTID"
		- STATEICP: state id (40 for Virginia)
		- COUNTYICP: county id ("0150" for Augusta)
		- SERIAL: family unit id (ipums gives as "SERIAL"; assigned in enumeration order, matching family_id)
		- PERNUM: person number in household (ipums gives as "PERNUM")
		- DWELLING: dwelling id (ipums gives as "DWELLING"; add to extract to reconstruct dwelling layer separately)
		- DWSEQ: dwelling sequence (ipums gives as "DWSEQ"; add to extract to reconstruct dwelling layer separately)
		- value_prop: value of property (ipums gives as "REALPROP")

	*Fetching*

		- Set samples
			- Turn off default samples
			- USA full count to year
			- Should be only one sample
		- Add variables as above (including DWELLING and DWSEQ)
		- Create extract
		- Select cases: STATEICP=40 AND COUNTYICP=0150 (Augusta County, Virginia)
		- rename file "ipums.csv"
		- copy to folder
		
	*Load files into memory*
		- load census.csv into a dataframe called "census"
		- load ipums.csv into a dataframe called "ipums"


