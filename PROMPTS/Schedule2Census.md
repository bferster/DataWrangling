**TASK: MATCH SLAVE SCHEDULE TO CENSUS **

	Knowing who was an enslaver is critical to our goal of identifying the enslaved, so we need to flag any verified census mentions of that person as an enslaver. 

	I want to create a list of enslavers from the Slave Schedule for the current county and record_year. Then match each enslaver to their listing in the census of the same year. If multiple people match beyond a threshold, add them to the mentions field. 
	county variable holds current county.
	record_year variable hold the record’s year.
	Save as a CSV file using papaparse when done for review.

*Code*

	Make a one-page app called: schedule2census.htm
	Use plain vanilla JavaScript 
	Use jquery and papaparse libraries
	The MatchName() code can be imported from @helpers.js

	Add a text input to set the county. Default to “AUG”
	Add a text input to set the threshold. Default to 75
	Add a pulldown to select between 1850 and 1860. 

	Use light them with light red background
	Raw data exists in a CSV file called mentions.csv in the ..\AI\DataWrangling\COMMON folder
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
		enumerator_date
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

	For each row in mentions.csv {
		if (source == county + ”-SS-“ + year), i.e. AUG-SS-1850 AND (head == TRUE)  {
			- Add new row to table.`
			- candidate_id = county + “-VP-SS-” + year + household_id (i.e. “AUG-VP-SS-1850-1234”.
			- If there is more than one member in household, get number of people with same household_id and put in household_count after subtracting 1, else 0
			- Extract enumerator and enumerator_date from the combined enumeration field separated by a colon (e.g. "JL:6.23" -> enumerator: "JL", enumerator_date: "6.23").
			- add fields described above to the row.
			}
		}


*Examine result*

	If I click on a result, add two scrollable display divs under the results display {
		- It has two scrollable divs, tall enought to show 3 lines of text.  
		- The top div shows the original line from the verified table.
		- The bottom div shows the original line from the census table.
		- Each has 24 rows of data 12 leading up to the selected row and 12 following the selected row.  
		- Highlight the center row.  
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
	enumerator
	enumerator_date
	}

	For each row in mentions.csv {
		- If source == county+”-CN-“+ record_year (I.e. AUG-CN-1850)
		AND birth_year is at least 12 years earlier that record_year
		AND norm_race == “W”,
		Extract enumerator and enumerator_date from enumeration (e.g. "JL:6.23") and add a row to censusCandidates using the fields mentioned above 
		}

*Find top schedule to census matches using FS+*

	- Use FS+ based matching techniques (Fellegi-Sunter probabilistic record linkage extended with enumerator and domain context).
	- Exclude non-people (i.e. have "estate" in their name).
	- De-dupe duplicate enslavers before matching so each unique enslaver is linked once.
	- Don't block on anything (do not restrict census candidates by race, age, or head of household).
	- Use the enum and enum_date fields in the data JSON field to link.
	- For each candidate pair:
		- Fellegi-Sunter name comparison (surname, given name, nicknames, phonetics) yields base log-LR bits.
		- Enumerator & date agreement: +4.0 bits for same enumerator & identical date; +3.0 bits for <= 1 day diff; +2.0 bits for <= 2 days diff; +1.0 bit for <= 7 days; -3.0 bits for conflicting enumerators.
		- District agreement: +1.0 bit; conflict: -1.0 bit.
		- Head of household: +1.0 bit if candidate is head; -0.5 bit if not.
		- Compute calibrated posterior probability: logit(p) = logit(prior) + ln(2) * totalBits.
	- Top 3 candidates populate mention1, mention2, and mention3.

*Save as CSV file (enslavers.csv)*

	- Output file name: enslavers.csv
	- Format is the standard Assertions format:
		assertion_id,subject_id,predicate,object_id,start_year,end_year,who,confidence,county
	- Both mention_ids are connected by an isSameAs predicate, and who field set to "FS+":
		AUG-SS-1850-123   isSameAs    AUG-CN-1850-456   FS+

**Review view mode**

	- Add a new button to the results display control called "Review"
	- If that is active, hide the why, probability, and score columns/chips, otherwise show them.
	- Add a pulldown to set HITL review mode to select "-" "MATCHED", "MAYBE", "UNMATCHED". (store in hitl_match field in output csv)
	- Add checkbox for "Sample" to show 500 sampled rows using Neyman Allocation:

		1. Stratify. It slices the candidates into 8 bins by match_probability, with bin boundaries at key evaluation thresholds (0.10, 0.25, 0.50, 0.75, 0.90, 0.95, 0.99). Bin H is the 0.01–0.10 junk band; bin A is the 0.99+ near-certain band.

		2. Allocate. It decides how many of the 500-sample budget to draw from each bin using Neyman allocation — sample more where the population is large and where the match rate is near 50% (most uncertain), fewer where it's lopsided. It uses each bin's mean posterior (pbar) as a stand-in for the true match rate, and enforces a floor of 35 per bin so no stratum is starved.

		3. Draw. Simple random sample within each bin, shuffle them together, and allow the reviewer to evaluate without being anchored by model scores.
