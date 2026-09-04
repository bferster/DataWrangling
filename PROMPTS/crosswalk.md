**CROSSWALK BETWEEN CENSUS YEARS**

	The version will be set before the script is called, for example "cnt" will generate "cnt_1850".
	I have a CSV file called crosswalk.csv that has a correlation between ipums_id from two census years. The particular years are different for each crosswalk file, but I need to write a script that can handle the different years. 	The two years will be can be found in the header (ie. histid_1870 if the year is 1870, histid_1880 if the year is 1880, etc.)

		- The 1850 ipums_id will be in the `histid_1850` column
		- The 1860 ipums_id will be in the `histid_1860` column
		- The 1870 ipums_id will be in the `histid_1870` column
		- The 1880 ipums_id will be in the `histid_1880` column
		- The 1900 ipums_id will be in the `histid_1900` column
		- The 1910 ipums_id will be in the `histid_1910` column
		- The 1920 ipums_id will be in the `histid_1920` column

	I also have transcribed censuses for these years, that contains the ipums_id and a line number:

		- 1850: https://docs.google.com/spreadsheets/d/1fbLpHU6na8Ndb9K2GCb6ClQlf8RQZXb5AqSOUEA8Ad0
		- 1860: https://docs.google.com/spreadsheets/d/1UsPJEPjg_Xfo0iqkmY0dvuw2mvzQH74Ou0VdxFryPVE
		- 1870: https://docs.google.com/spreadsheets/d/1-pJ3MrWWEnPyrSNE8QxVi-EfxyO-oLhlwMudygU3HG8
		- 1880: https://docs.google.com/spreadsheets/d/1W4Z4mu9LqnrxUhpAi5r2nxJgNFW2HLUhMbAohDzR7Qo

	Line numbers are unique only within a single year's transcript — a line number from one year cannot be compared to, or matched against, a line number from another year. The only value that is ever matched across files is the ipums_id (histid). Line numbers are looked up from a year's own transcript and used only when writing output, never for matching.

	The results file is called AUG-Crosswalk.csv with the following fields:

		id_1850, cnt_1850, clp_1850,
		id_1860, cnt_1860, clp_1860,
		id_1870, cnt_1870, clp_1870,
		id_1880, cnt_1880, clp_1880,
		id_1900, cnt_1900, clp_1900,
		id_1910, cnt_1910, clp_1910,
		id_1920, cnt_1920, clp_1920

	I need to use this file to create a script that will do this following:

		- Identify the source_year (i.e. 1870).
		- The other year will be the target_year (i.e. 1880).
		- Load the source_year's census into memory, and build line_lookup_source: a map from histid_<source_year> to line number, using that year's own transcript.
		- Load the target_year's census into memory, and build line_lookup_target: a map from histid_<target_year> to line number, using that year's own transcript.
		- Load crosswalk.csv into memory.
		- Load the existing AUG-Crosswalk.csv, and for each year present in it, build a histid index for that year {
			- For each row, if id_<year> is populated, convert it back to a histid using that year's line_lookup, and add it to the year's histid index.
			- For each row, if any cw*_<year> column is populated, add that histid directly to the year's histid index (these are already histids, not line numbers).
			}
		- For each row in the source census {
			- Look up histid_<source_year> in the crosswalk file.
			- If there is no match in the crosswalk file, skip this row — nothing is written.
			- If there is a match, get histid_<target_year> from the crosswalk row.
			- If histid_<source_year> is not present in line_lookup_source, skip this row — nothing is written.
			- If histid_<target_year> is not present in line_lookup_target, skip this row — nothing is written.
			- Look up histid_<source_year> in the source_year's existing histid index, and histid_<target_year> in the target_year's existing histid index {
				- If both are found in the same existing AUG-Crosswalk.csv row, there is nothing to do — this link is already recorded.
				- If both are found, but in different existing rows, flag this as a conflict for manual review (e.g. a conflict_flag column or a separate AUG-Crosswalk-conflicts.csv) — do not merge the rows automatically.
				- If the source histid is found in an existing row but the target is not, write line_lookup_target[histid_<target_year>] into the empty id_<target_year> cell of that existing row, and the raw histid_<target_year> into the appropriate cw*_<target_year> cell.
				- If neither is found, create one new row. Write line_lookup_source[histid_<source_year>] into id_<source_year>, and line_lookup_target[histid_<target_year>] into id_<target_year>. Write the raw histid_<target_year> into the appropriate cw<version>_<target_year> cell.
				}
			}