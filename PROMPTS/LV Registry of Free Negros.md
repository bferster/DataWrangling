I have a document, a pdf of a Registry of free negros. 
I want to make a csv file of the data in the following format:
- Line, Age,Sex,Color, Height, Registration Number, Registration Date, Additional; Info

- Here is a sample to turn into a row:

	Name: Andrew Vind
	Age: 21
	Sex: Male
	Color: black
	Height: 5 ft 8 in
	Registration number: 1
	Registration date: 1810-07-20
	Additional Info: Bound to the Overseer of the poor in Culpeper County to William Barber by
	Indenture 25th of July 1798 as appears by the certificate of John Jamison, clerk of Cul 

- Create a python script that will run on my computer to extract this information from the document.
Run that python script and save the .csv file in the same folder.

Document to parse is: @FauquierFBR.pdf

/*
unmerge all cells in sheet
are there any duplicate rows. if so remove the duplicate
convert record_year values to just the year portion
if age and record_year values are not null, set birth_year as record_year - age
convert height into inches: i.e. 5 ft 8 in = 68
*/