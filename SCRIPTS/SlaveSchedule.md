**TASK**

	- Create a python script that will run on my computer to extract this information from the document.
	- Run that python script and save the .csv file in the DATA folder.
	- myData is the file to convert: (i.e. myData='augSS1850.csv')
	- myCounty is the county to use: ie. myCounty="AUG"
	- myYear is the year to use: ie. myYear="1850"


**SLAVE SCHEDULE FORMAT**

	This file is a transcription of the US slave schedules for 1850 and 1860. 
	It is a table with 10 columns. 
	Each row represents an enslaved person or an enslaver.
	There may be omissions, duplications, and errors in this data. 
	Some fields may be not be present in table.

**Ingested field names and descriptions:**
	
	- line - A unique identifier for the row
	- full_name - The full name of the person (names may be blank).
	- first_name - The first name of the person.
	- middle_name - The middle name of the person.
	- last_name - The last name of the person.  
	- age - The age of the person in 1870
	- birth_year - The year the person was born. May be inaccurate +/- 5 years
	- gender - The sex of the person. Can be F for female or M for male
	- race - The race of the person. B, W, M, I, C or Y
	- status - The name of the enslaver of the person : if this value is "Y" it means that this row is an enslaver.
	
**Example rows to ingest**


	|line | full_name | age |birth_year |gender |race | owner |
	|-----|-----------|-----|-----------|-------|-----|-------|
	|  1  | John Taylor |   |           |       |     | Y     | 
	|  2  |   	       | 36 | 1814      | M     | B   |       |
	|  3  |            | 25 | 1825      | M     | M   |       |
	|  4  |            | 16 | 1834      | M     | B   |       |
	|  5  |            | 14 | 1836      | M     | B   |       |
	|  6  |            | 7  | 1843      | M     | B   |       |
	|  7  |            | 0  | 1850      | M     | B   |       |
	|  8  |            | 40 | 1810      | M     | B   |       |


**Output field names and descriptions:**

	- line - A unique identifier for the row
	- full_name - The combination of the first-name, the middle_name, and the last_name separated by spaces 
	- age - The age of the person in year of the scheduleL 1850 or 1860
	- birth_year - The year the person was born.
	- gender - The sex of the person. Can be F for female or M for male
	- race - The race of the person: B, W, M, I, C or Y

**Translation instructions**

	- The source_year field is set to 1850 or 1860.
	- Source is set to county-SS-source_year (i.e ALB-SS-1880)
	- The original_data field is set to the entire row as a JSONB object.
	- The confidence field is set to 0.83 for both assertions and mentions.	
	- Apply the normalization as described in @Normalize.md.
	- Add mention to mentions table.

**Creating the mention_id**

	- The mention_id is created as follows:
		- Each source has a unique prefix: for example: ALB-SS-1850-1, where  "ALB" is the county, "SS" is the source type, "1850" is the year and "1" is the line number from the line field in the row. 
	- If there is already an identical mention_id within this source append a number to it to differentiate it, like this for the first one: ALB-SS-1850-1.1, ALB-SS-1850-1.2 for the second, etc.

**Add enslaver mentions**

	- Add a mention for each row where the status field is "Owner":
		- If the enslaver_full_name has already been added while ingesting this source, don't add this mention.
		- age, race, gender, and birth_year fields are ignored.
		- head is set to true.
		- race is set to "W".
		- Set the legal_status field is set to NULL.
			- The first_name, middle_name, and last_name fields are set, if there.
		- Add mention to mentions table.
	
**Add enslaved persons mentions**

	- This occurs after all mentions for the enslaved people have been added to the mentions table.
		- Add a mention for each row where the status field is not "Owner":
			- The source_year field is set to 1850 or 1860.
			- Set the legal_status field is set to "E".
			- head is set to NULL.
			- Normalize race and gender according to @Normalize.md.
			- Set age, race, gender, and birth_year fields.
			- Add mention to mentions table.

**Add assertions**

	- This occurs after all mentions have been added to the mentions table.
	- Make a look-up table of names from the enslaver_full_name field and the enslaver's mention_id
	- For each enslaved mention {
		- Use the enslaver_full_name field to find the enslaver's mention_id from the look-up table.
		- Create assertion row data:
			- subject: enslaved person's mention_id.
			- predicate: wasEnslavedBy.
			- object: enslaver's mention_id.
			- who: "SS", 
			- start_year: 1850 or 1860.
			- end_year: NULL.	
		- Add assertion to assertions table.
	}

**Add household ID**

	- This occurs after all mentions have been added to the mentions table.
	- For each enslaver mention created, create a household_id as follows:
		- "HS"+source_year+#, where # is the sequential number of the household mention, starting at 1. (i.e HS1850-4546)
	- Then, for every mention, add the appropriate household_id  to the household_id field in the mentions table.

**Output CSV format**`

- save the assertions table to a csv file called resultsAssertions.csv with columns:
	  subject, predicate, object, who, start_year, end_year, confidence
- save the mentions table to a csv file called resultsMentions.csv with columns:
	  mention_id, source, full_name, first_name, middle_name, last_name, age, birth_year, gender, race, head, legal_status
