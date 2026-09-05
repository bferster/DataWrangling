**CROSSWALK BETWEEN CENSUS YEARS**

	The county code and the source and method of each crosswalk file will be set before the script is called. The county code names the output file (i.e. `AUG` produces `AUG-Crosswalk.csv`). The source and method is used as the `who` value on every assertion the run produces. Sources are versioned and method variants are kept distinct, for example: `cnt` (Census Tree), `clp`, `mlp`, `ver`.

	I have a CSV file called crosswalk.csv that has a correlation between ipums_id from two census years. The particular years are different for each crosswalk file, but I need to write a script that can handle the different years. The two years will be can be found in the header (ie. histid_1870 if the year is 1870, histid_1880 if the year is 1880, etc.)

		- The 1850 ipums_id will be in the `histid_1850` column
		- The 1860 ipums_id will be in the `histid_1860` column
		- The 1870 ipums_id will be in the `histid_1870` column
		- The 1880 ipums_id will be in the `histid_1880` column
		- The 1900 ipums_id will be in the `histid_1900` column
		- The 1910 ipums_id will be in the `histid_1910` column
		- The 1920 ipums_id will be in the `histid_1920` column

	I also have transcribed censuses for these years, that contains the ipums_id and a mention_id:

		- 1850: https://docs.google.com/spreadsheets/d/1fbLpHU6na8Ndb9K2GCb6ClQlf8RQZXb5AqSOUEA8Ad0
		- 1860: https://docs.google.com/spreadsheets/d/1UsPJEPjg_Xfo0iqkmY0dvuw2mvzQH74Ou0VdxFryPVE
		- 1870: https://docs.google.com/spreadsheets/d/1-pJ3MrWWEnPyrSNE8QxVi-EfxyO-oLhlwMudygU3HG8
		- 1880: https://docs.google.com/spreadsheets/d/1W4Z4mu9LqnrxUhpAi5r2nxJgNFW2HLUhMbAohDzR7Qo

	The histid is the only value ever matched across files. It is used to resolve each side of a crosswalk link to a mention_id in my own transcripts, and is not itself stored in the output. Mention_ids are unique across all years and sources, so they can be used directly as assertion subjects and objects.

	The results file is called <county>-Crosswalk.csv (i.e. AUG-Crosswalk.csv), using the standard assertion schema:

		assertion_id, subject_id, predicate, object_id, start_year, end_year, who, confidence

	If the file does not already exist, the script creates it and writes the header row. If it does exist, the script appends to it — each run concatenates onto whatever is already there.

	Each accepted crosswalk link becomes one `isSameAs` assertion:

		- assertion_id is a randomly generated unique id (e.g. a UUID), minted per assertion. The script never reads existing assertion_ids and never derives an id from the data.
		- subject_id and object_id are mention_ids from my transcripts
		- predicate is always `isSameAs`
		- isSameAs is symmetric, so a canonical direction is enforced: the mention from the earlier census year is always the subject_id, and the mention from the later year is always the object_id
		- start_year is the earlier census year, end_year is the later census year
		- who is the source/method value set before the script is called
		- confidence is left blank until source accuracy has been measured against Augusta data

	Ingestion is append-only. Apart from checking whether the results file exists, the script never reads, modifies, merges, or deletes anything already in it. The same crosswalk file may be re-ingested, and multiple sources may be ingested in any order.

	I need to use this file to create a script that will do this following:

		- Identify the source_year (i.e. 1870).
		- The other year will be the target_year (i.e. 1880).
		- Load the source_year's census into memory, and build histid_to_mention_source: a map from histid_<source_year> to mention_id, using that year's own transcript.
		- Load the target_year's census into memory, and build histid_to_mention_target: a map from histid_<target_year> to mention_id, using that year's own transcript.
		- Load crosswalk.csv into memory.
		- Open <county>-Crosswalk.csv for appending, creating it with a header row if it does not exist.
		- For each row in crosswalk.csv {
			- Get histid_<source_year> and histid_<target_year> from the row.
			- If either histid is missing or blank, skip this row — nothing is written.
			- If histid_<source_year> is not present in histid_to_mention_source, skip this row — nothing is written.
			- If histid_<target_year> is not present in histid_to_mention_target, skip this row — nothing is written.
			- Resolve both histids to their mention_ids.
			- Determine which of the two years is earlier, and assign that year's mention_id to subject_id and the later year's mention_id to object_id.
			- Append one assertion: a newly generated random assertion_id, subject_id, predicate `isSameAs`, object_id, start_year = earlier year, end_year = later year, who = the source/method value, confidence blank.
			}
		- Report counts at the end of the run: rows read, rows skipped for a missing histid in the crosswalk file, rows skipped because the source histid was not in my transcript, rows skipped because the target histid was not in my transcript, and assertions written.

**SOURCES**

	This section is for information only.

	Census Tree — built by Joseph Price and Kasey Buckles (with Adrian Haws and Haley Wilbert), based at BYU and Notre Dame. Method: seeded from links that amateur genealogists already made on FamilySearch — 133 million male pairs, 121 million female pairs across 1850–1940 — then extended with machine learning trained on that same crowd-sourced data. Optimized for recall and representativeness — designed explicitly to include women and Black Americans at far higher rates than name-matching methods can manage, since the underlying human links draw on evidence outside the census itself (wills, obituaries, family knowledge). The tradeoff is a training-data circularity concern researchers in the field note explicitly: it performs well on genealogical benchmark data partly because it was trained on genealogical data. 700 million+ links total, distributed year-pair by year-pair through openICPSR.

	Hand 

		Base year	Linked to	Project	Link
		1850	1860	193225	https://www.openicpsr.org/openicpsr/project/193225/version/V1/view
		1860	1870	193235	https://www.openicpsr.org/openicpsr/project/193235/version/V1/view
		1870	1880	193246	https://www.openicpsr.org/openicpsr/project/193246/version/V1/view
		1880	1910	193250	https://www.openicpsr.org/openicpsr/project/193250/version/V1/view

	Census Linking Project (CLP) — built by Ran Abramitzky, Leah Boustan, and Katherine Eriksson (with James Feigenbaum and Santiago Pérez), based at Stanford, Princeton, and UC Davis. Method: deterministic exact-ish matching on first name, last name, and birthplace, with a couple of years' tolerance on birth year and NYSIIS phonetic standardization to absorb spelling variation. Optimized for precision over recall — a link is only made when the evidence is strong and unambiguous, which means high confidence but a lot of real matches go unfound, especially for women (many implementations link men only, since a changed surname breaks the exact-match rule) and for populations with less name/spelling stability. 45 crosswalks covering every census pair 1850–1950, free at censuslinkingproject.org, code included.

		https://censuslinkingproject.org/data/