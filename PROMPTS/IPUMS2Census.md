
**TASK: Match IPUMS records to census transcription**

	I have 2 CSV files: my full transcription of the census for a given year, called and a data file that contains much of the same information as a file from IPUMS. I want to add s0me fields from IPUMS to my cannonical census file.
	.
*Inputs*

	census.csv — full transcription of the census for a given year (source of truth; row count and row order must not change)
	ipums.csv — corresponding IPUMS extract for the same year. Gender matches census.csv's scheme exactly. Race does NOT match 1:1: ipums.csv's norm_race collapses Mulatto ("M") into Black ("B"), giving only B/W/I, while census.csv keeps M as a distinct code (B/M/W). Treat this as an intentional, documented bucketing, not a bug to route around.

*Output columns to add/update in census.csv*
	
	ipums_id 
	prop_value — only if this is the 1850, 1860, or 1870 file.
	relation — update/populate from IPUMS for 1850, 1860, and 1870 files; do NOT update or overwrite for 1880 on.
	ipums_match
Do not add, remove, or reorder rows in census.csv. Every existing row and column stays as-is (NEVER update or overwrite the head column in census.csv); only new columns are appended or permitted fields updated.

*Step 1 — Group both files into households*

	In census.csv, group rows by family field (consecutive family groups within district).
	In ipums.csv, group rows by family field.
	- Group Quarters / Institutions: 
		- Merge consecutive rows with relate="Group" into a single continuous institutional household block rather than isolated 1-person records.
		- In historical censuses where IPUMS indexed large boarding schools, seminaries, or asylums as consecutive 1-person family units (relate="Self") while census.csv grouped them under a single family ID, identify these as institutional candidate blocks.
	- Parse infant/fractional ages: Convert Excel date formats (e.g., "12-Jan", "12-Jun"), fractions ("6/12"), and values <= 1.0 to infant age 0.
	- Each group becomes a household record: the ordered list of its members’ (age, gender, race, birthplace-if-present).

*Step 2 — Match households to households*

	- Pass 1 (Standard Mutual Matching): For each census household, score it against candidate ipums households using: household size (exact or ±2), and the multiset similarity of member ages (within ±2 years) combined with exact gender and exact race match per the rule below.	
	- Pass 2 (Continuation Merging for Split Families): For remaining unmatched census households, test merging consecutive adjacent census units where the continuation unit lacks an independent head or represents an over-split family. If the combined unit matches a single IPUMS household with >= 70% confidence, accept the merged household match.
	- Institutional Blocks (> 15 members): Where an institution was fragmented by IPUMS into multiple single-person units, anchor on the facility lead/head demographics and evaluate contiguous sequential register alignment or facility pool demographic matching across consecutive IPUMS records.
	- A household match is accepted only if it clears a stated minimum confidence threshold and is the single best-scoring ipums household for that census household and that census household is the single best match for that ipums household (mutual best match — a simple two-sided uniqueness check, not full Hungarian assignment, since household counts are close but not identical between the two files).
	- If no ipums household clears the threshold, or the best match is not mutual, leave the whole household unmatched: all its member rows get blank ipums_id and blank ipums_match columns. Do not fall back to person-level matching against an unmatched household’s members.

*Step 3 — Match people within matched households*

	- Within a matched household pair, match census rows to ipums rows one-to-one:
		- Gender: must match exactly. No exceptions, no fuzzy handling.
		- Race: must match exactly on a shared 3-way bucket — collapse census.csv's "M" into "B" before comparing, then require an exact match against ipums.csv's norm_race (B / W / I). This means a census row originally coded M can match an ipums row coded B, and vice versa; that is expected, not a fuzzy exception. No other race substitutions are allowed.
		- Birth_year / Age: compare with a stated tolerance (e.g. ±2 years); score closer ages higher.
		- If age column contains fractional/date infant ages, match on infant age 0.
		- For Group Quarters and Institutional facilities (e.g., Asylums, Boarding Schools): match individuals by demographic signature (exact gender, exact race, age ± 1) from the facility pool in original manuscript register order.

	- Enforce one-to-one uniqueness within the household: no ipums person serves two census rows and vice versa. Where multiple census rows tie for the same best ipums row (e.g. two same-age, same-gender, same-race siblings), leave all tied rows unmatched rather than guessing an order — a wrong sibling assignment is worse than no assignment, and a note should be left (e.g. a value in the ipums_match column like "TIE").
	- If no ipums person in the matched household clears a minimum person-level confidence threshold, leave that row unmatched.

*Step 4 — Populate output*

	- For every uniquely and confidently matched person, copy ipums_id, prop_value (if 1850, 1860, or 1870), and relation (if 1850, 1860, or 1870), along with ipums_match score.
	- For 1880 and later census files, do NOT update or overwrite the existing relation field.
	- NEVER update or overwrite the head column in census.csv for any census year.
	- For every unmatched row — whether household-level or person-level failure — leave ipums_id, prop_value, and ipums_match columns blank. Do not force a low-confidence guess into the output.


// RUN SCRIPT FROM BASH: python match_ipums.py
 //
**Getting data from IPUMS**

	*Data to get*

		- age: ipums gives age as "AGE" in whole years
		- gender: ipums gives gender as "SEX" with 1 = Male and 2 = Female
		- birth_year: ipums gives birth year as "BIRTHYR" in whole years
		- race: ipums gives detailed race as "RACED"
		- relate: ipums gives detailed relationship as "RELATED"
		- birth_place: ipums gives birthplace ipums gives "BPL" as birth place
		- ipubs_id: ipubs gives as "HISTID"
		- STATEICP: state id. (40 for Virginia)
		- COUNTYICP: county id. "0150" for Augusta
		- SERIAL: family id. ipums gives as "SERIAL"
		- PERNUM: person number in household. ipums gives as "PERNUM"
		- DWELLING: dwelling id. ipums gives as "DWELLING"
		- value_prop: value of property ipums gives as "REALPROP"

	*Fetching*

		- Set samples
			- Turn off default samples
			- USA full count to year
			- Should be only one sample
		- Add variables as above
		- Create extract
		- Select cases: STATEICP=40 AND COUNTYICP=0150 (Augusta County, Virginia)
		- rename file "ipubs.csv"
		- copy to folder
		
	*Load files into memory*
		- load census.csv into a dataframe called "census"
		- load ipubs.csv into a dataframe called "ipubs"

