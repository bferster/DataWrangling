**TASK: MATCH SLAVE SCHEDULE TO CENSUS **

	I want to create a list of enslavers from the Slave Schedule for the current county and record_year. Then match each enslaver to their listing in the census of the same year. If multiple people match beyond a threshold, add them to the mentions field. 
	county variable holds current county.
	record_year variable hold the record’s year.
	Save as a CSV file using papaparse when done for HITL verification.

*Code*

	Make a one-page app called: schedule2census.htm
	Use plain vanilla JavaScript 
	Use jquery and papaparse libraries
	The MatchName() code can be imported from @helpers.js

	Add a text input to set the county. Default to “AUG”
	Add a text input to set the threshold. Default to 75
	Add a pulldown to select between 1850 and 1860. 

	raw data exists in a CSV file called mentions.csv in the ../AI/Verite/img folder
	Use MatchName in the ../Verite/match.js file

*Extract enslaver table*

	Create a candidate table called county + “-VP-SS-“ + record_year + (i.e “AUG-VP-SS-1850”) with fields {
		candidate_id
		mention_id
		full_name
		first_name
		middle_name
		last_name
		norm_first_name
		nysiis_last_name
		metaphone_last_name
		head
		district
		original_line
		enumerator
		enumerator (in the original_data object)
		enumerator_date (original_data) 
		household_count
		mention1 {}
		mention2 {}
		mention3 {}
		}
	
	mention1, mention2, and mention3 are JSON encoded objects of these fields: {
		full_name in census
		mention_id
		confidence	
		scores {}
		}
	enumerator and enumerator_date are in the original_data object

	For each row in mentions.csv {
		if (source == county + ”-SS-“ + year), i.e. AUG-SS-1850 AND (head == TRUE)  {
			- Add new row to table.`
			- candidate_id = county + “-VP-SS-” + year + household_id (i.e. “AUG-VP-SS-1850-1234”.
			- If there is more than one member in household, get number of people with same household_id and put in household_count after subtracting 1, else 0
			- add fields described above to the row.
			}
		}

*Extract census candidates table*

	Create a census table called ”censusCandidates”  with fields {
	mention_id
	full_name
	first_name
	middle_name
	last_name
	norm_first_name
	nysiis_last_name
	head
	metaphone_last_name
	birth_year
	district
	original_line
	enumerator (in the original_data object)
	enumerator_date (original_data) 
	}

	For each row in mentions.csv {
		- If source == county+”-CN-“+ record_year (I.e. AUG-CN-1850)
		AND birth_year is at least 12 years earlier that record_year
		AND norm_race == “W”,
		Add a row to censusCandidates using the fields mentioned above 
		}

*Find top schedule to census matches*

	For each row in table {
		find matches {
			- Score name using MatchName(). Returns 0.0 to 1.0
			- After matching by name {
				- Add a bonus of 0.2 if the districts are the same in both tables.
				- Add a bonus of 0.3 if the matched person is a head in the candidate table.
				- Add bonus if enumerator AND enumerator_date are close in both tables {
				- 0.1 is one day
				- ADD 0.5 if they are 0 apart
			 		OR: Add 0.4, if they are 0.1 apart from one another
				    OR: Add 0.3 for 0.2 apart
				    OR: Add 0.2 for 0.7 apart
				}
				Set confidence of score + bonus.
		}
		Add mentions that exceed the threshold to mentions field in enslavers table {
			The highest scoring in mention1
			The 2nd highest scoring in mention2
			The 3rd highest scoring in mention3
		}
	}

*Corroborate with other data*
	- TBD

*Save as CSV file*

	- Columns to save: mention_id, full_name, mention1, mention2, mention3
	- (Exclude candidate_id, first_name, middle_name, last_name, norm_first_name, nysiis_last_name, metaphone_last_name, head, district, original_line, enumerator, enumerator_date, household_count)
	- When saving mention1, mention2, and mention3 fields, encode each object as JSON (e.g. {} if no match).
	- Save enslavers table to disc as county + “-VP-SS-“ + year + “.csv” (i.e “AUG-VP-SS-1850.csv”) 



