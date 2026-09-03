**TASK**

- I want to scrape the following information from a website

Each page has a number of rows of individuals in this format:

	Mary Elizabeth Martin Abell
	30 Mar 1877 – 31 Aug 1926
	White Hall, Albemarle County, Virginia

The data to extract is:

	line: 1	
	full_name: Mary Elizabeth Martin Abell
	birth_year: 1877
	death_year: 1926
	location: White Hall, Albemarle County, Virginia

Rules:

	- Remove all punctuation and special characters from full_name and location, except quotes
	- Remove the following prefixes from full_name: "PVT ", "COL ", "SGT ", "MR ", "DR ", "CAPT ", "MRS ", "LTC ", "LT ", "CPL ", "PFC ", "REV ", "1SGT"CPT","MAJ", "GEN", "ENS", "CORP". These are case-insensitive. Don't start the string with a space.
	- Don't add row if all fields are empty.
	- Line numbers start at 1 and increment by 1 each row
	- Each page has many entries. 
	- Extract all the data from each page and save it to a CSV file. 
	- Each page has a "next Page" button to go to the next page of results. Use this to go through all the pages.


I want to scrape the following information from this website:

https://www.findagrave.com/memorial/search?fulltext=&firstname=&middlename=&lastname=&birthyear=1750&birthyearfilter=after&deathyear=1950&deathyearfilter=before&location=Albemarle+County%2C+Virginia%2C+United+States+of+America&locationId=county_2804&bio=&linkedToName=&plot=&memorialid=&mcid=&datefilter=&orderby=b&includeNickName=true&includeMaidenName=true&includeTitles=true&exactName=true



