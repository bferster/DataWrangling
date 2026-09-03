**TASK: Format IPUMS data for census  matching**

*Normalizing ipubs.csv*

- Remove YEAR, HHWT, SAMPLE, RACE, RELATE, GQ, PERWT, STATEICP, COUNTYICP, and VERSIONHIST
- Add new column norm_race and head
- Rename columns to: 
	- SEX to gender,
	- RELATED to relate,
	- BIRTHYR to birth_year,
	- RACED to race,
	- BPL to birth_place,
	- DWELLING to dwelling,
	- REALPROP to prop_value,
	- HISTID to ipubs_id,
	- SERIAL to family
	- PERNUM to person_num

*Translate codes to values*

	gender (SEX): 1 = M, 2 = F

	race (RACED): 100 = W, 120 = W, 200 = B, 210 = M, 300 = I, 400 = C, 500 = J

	relate (RELATED):
		101 = Self
		201 = Spouse
		301 = Child
		401 = Child-in-law
		501 = Parent
		601 = Parent-in-law
		701 = Sibling
		801 = Sibling-in-law
		901 = Grandchild
		1001 = Relative
		1101 = Partner
		1200 = Employee
		1300 = Group
		9900 = Other

	birth_place (BPL):
		51 = VA
		24 = MD
		37 = NC
		45 = SC
		42 = PA
		21 = KY
		47 = TN
		11 = DC

*Normalize race*

	for each row in ipums {
		if (race == "B") norm_race = "B"
		if (race == "M") norm_race = "B"
		if (race == "W") norm_race = "W"
		if (race == "I") norm_race = "I"
		if (race == "C") norm_race = "W"
		if (race == "J") norm_race = "W"
	}

*Normalize relate*
	for each row in ipums {
		if (relate == "101") norm_relate = "Self"
		if (relate == "201") norm_relate = "Spouse"
		if (relate == "301") norm_relate = "Child"
		if (relate == "401") norm_relate = "Child-in-law"
		if (relate == "501") norm_relate = "Parent"
		if (relate == "601") norm_relate = "Parent-in-law"
		if (relate == "701") norm_relate = "Sibling"
		if (relate == "801") norm_relate = "Sibling-in-law"
		if (relate == "901") norm_relate = "Grandchild"
		if (relate == "1001") norm_relate = "Relative"
		if (relate == "1101") norm_relate = "Partner"
		if (relate == "1200") norm_relate = "Employee"
		if (relate == "1300") norm_relate = "Group"
		if (relate == "9900") norm_relate = "Other"
	}

*Normalize birth_place*
	for each row in ipums {
		if (birth_place == "51") norm_birth_place = "VA"
		if (birth_place == "24") norm_birth_place = "MD"
		if (birth_place == "37") norm_birth_place = "NC"
		if (birth_place == "45") norm_birth_place = "SC"
		if (birth_place == "42") norm_birth_place = "PA"
		if (birth_place == "21") norm_birth_place = "KY"
		if (birth_place == "47") norm_birth_place = "TN"
		if (birth_place == "11") norm_birth_place = "DC"
	}

*Set head*

- for each row in ipums
- 	if relate == "Self" set head to "Y"

*Save out to ipums.csv*