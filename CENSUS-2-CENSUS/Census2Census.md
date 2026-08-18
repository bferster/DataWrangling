**LINK PEOPLE LIST TO 1860 CENSUS**

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

	The verified list is loaded from the file. For Augusta, that file is AUG-VP.csv. 
	The census is loaded from mentions.csv, filtering for only rows with the source: and record year. (i.e. AUG-CN-1860).

*Find matches*

	Set floor and ceiling thresholds.
	Handle year range  comparisons implicitly.
	Block on race, gender, birth_year, and death_year {
		Ignore when norm_race is different.
		Ignore when gender is different.
		Ignore if  birth_yea is more than 15 years apart and either are not NULL.
		Ignore if verified death_year is before 1859 and either are not NULL.
		}
	For each row in verified, find the matching row in census {
		Use MatchPerson() from the  method to find matches, factoring the name, birth_year, and death_year values. It also scores for common family members. 
		Save match score in score field.
		Save probability in probability field.
		Why - details on the scoring.
		If the score is below floor, set status as "NEW".
		Else if score is above ceiling, set status as “MATCH”,
		Else set status as “MAYBE”.
		}
*Reconcile*

	If two or more persons claim the same census row as MATCH, keep the highest-scoring claim as MATCH and demote the others to MAYBE. When a person's top two census candidates are within a small margin, force MAYBE rather than MATCH.

*Save as CSV for human review*

	Initialize the probability using fitNameCalibration() in Match class once.
	
	Calculate the probability using nameProbability() in Match class for each matched pair. 
	
	Save the following columns from the census list  {
		status
		probability
		score
		full_name of census : full_name of verified
		birth_year of census : birth_year of verified
		gender of census : gender of verified
		norm_race of census : norm_race of verified
		mention_id	
		person_id
		why
		}

	How to make the why field {
		Break the score into its levers using matchNameDetail() {
			name: (i.e. 1.0)
			birth: (i.e. .6)
			family: (i.e. .9)
			rung: (i.e. EXACT_FIRST_SUR)
			surnameKind: (i.e. EXACT_LASTNAME)
			needsCorroboration: (i.e. TRUE)
		}
		
		Show which household members corroborated:
			family: (i.e. Samuel Lightner-1817, Lucy-1823)
		
		Show up to 3 runner-ups if a MAYBE {
			mention_id: (i.e. AUG-CN-1860-1234)
			nameScore: (i.e. 1.0)
			birthScore: (i.e. .6)
			familyScore: (i.e. .9)
			rung: (i.e. EXACT_FIRST_SUR)
			surnameKind: (i.e. EXACT_LASTNAME)
			needsCorroboration: (i.e. TRUE)
			runnerUpScore: (i.e. .58)
			}
	}

	Save table to disc as “HITL1860“.csv” 
	

		


