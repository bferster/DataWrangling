import csv
import re

def clean_csv():
    prefixes = [
        "PVT ", "COL ", "SGT ", "MR ", "DR ", "CAPT ", "MRS ", "LTC ", "LT ", "CPL ", 
        "PFC ", "REV ", "1SGT ", "CPT ", "MAJ ", "GEN ", "ENS ", "CORP ",
        "PVT.", "COL.", "SGT.", "MR.", "DR.", "CAPT.", "MRS.", "LTC.", "LT.", "CPL.",
        "PFC.", "REV.", "1SGT.", "CPT.", "MAJ.", "GEN.", "ENS.", "CORP.",
        "PVT", "COL", "SGT", "MR", "DR", "CAPT", "MRS", "LTC", "LT", "CPL", 
        "PFC", "REV", "1SGT", "CPT", "MAJ", "GEN", "ENS", "CORP"
    ]
    # sort by length descending to match longest first
    prefixes.sort(key=len, reverse=True)

    with open('results.csv', 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        header = next(reader)
        
        if header[0] != "line":
            new_header = ["line"] + header
        else:
            new_header = header
            
        rows = []
        line_num = 1
        for row in reader:
            if not any(field.strip() for field in row):
                continue
            
            if header[0] == "line":
                actual_row = row[1:]
            else:
                actual_row = row
                
            if len(actual_row) < 4:
                continue
                
            full_name = actual_row[0]
            birth_year = actual_row[1]
            death_year = actual_row[2]
            location = actual_row[3]
            
            # Remove prefixes
            changed = True
            while changed:
                changed = False
                for p in prefixes:
                    # check if the name starts with the prefix. If prefix is without space/dot, 
                    # make sure it is a whole word by checking next character if possible.
                    if full_name.upper().startswith(p.upper()):
                        # Only strip if it matches the prefix exactly or with space/dot
                        if p.endswith(" ") or p.endswith(".") or len(full_name) == len(p) or full_name[len(p)] == " ":
                            full_name = full_name[len(p):].lstrip(". ")
                            changed = True
                            break
            
            # Remove punctuation except quotes
            # \w matches letters, digits, and underscores. 
            # So we use [^\w\s\'"“”‘’] to remove non-word/space/quote, and replace '_' with ''
            full_name = re.sub(r'[^\w\s\'"“”‘’]', '', full_name).replace('_', '')
            location = re.sub(r'[^\w\s\'"“”‘’]', '', location).replace('_', '')
            
            full_name = re.sub(r'\s+', ' ', full_name).strip()
            location = re.sub(r'\s+', ' ', location).strip()
            
            if not (full_name or birth_year or death_year or location):
                continue
                
            rows.append([line_num, full_name, birth_year, death_year, location])
            line_num += 1

    with open('results.csv', 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(new_header)
        for row in rows:
            writer.writerow(row)

clean_csv()
print("CSV cleaned successfully.")
