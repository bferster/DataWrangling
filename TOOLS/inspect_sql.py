import os
import re

sql_file = os.path.join("Ed's data", "api-valley-newamericanhistory-org_20260630_14-54-02.sql")

table_counts = {}
pop_census_county_year = {}

def parse_sql():
    with open(sql_file, 'r', encoding='utf-8', errors='ignore') as f:
        current_table = None
        cols = []
        for line in f:
            if line.startswith('INSERT INTO'):
                match = re.search(r'INSERT INTO `([^`]+)` \(([^)]+)\)', line)
                if match:
                    current_table = match.group(1)
                    cols = [c.strip(' `') for c in match.group(2).split(',')]
                    table_counts[current_table] = table_counts.get(current_table, 0)
                continue
            
            if current_table and line.strip().startswith('('):
                table_counts[current_table] = table_counts.get(current_table, 0) + 1
                if current_table == 'population_census':
                    # Parse values line roughly or accurately
                    # Line looks like: \t(1,'augusta',1860,'Mary',...
                    # Let's extract county and year
                    val_str = line.strip()
                    # simple comma split for county (col index 1) and year (col index 2)
                    # Note: col 0 is id, col 1 is county, col 2 is year
                    # Let's do a simple regex for first 3 values
                    m = re.match(r'^\((\d+),\s*\'([^\']+)\',\s*(\d+)', val_str)
                    if m:
                        c_id, county, year = m.group(1), m.group(2), m.group(3)
                        key = (county.lower(), year)
                        pop_census_county_year[key] = pop_census_county_year.get(key, 0) + 1

    print("Table row counts:")
    for t, c in table_counts.items():
        print(f"  {t}: {c}")

    print("\nPopulation Census (county, year) counts:")
    for (county, year), c in pop_census_county_year.items():
        print(f"  County: '{county}', Year: {year} => {c} rows")

if __name__ == '__main__':
    parse_sql()
