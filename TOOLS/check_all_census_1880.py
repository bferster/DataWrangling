import os
import re

sql_path = os.path.join("Ed's data", "api-valley-newamericanhistory-org_20260630_14-54-02.sql")

def check_census_tables():
    results = {}
    with open(sql_path, 'r', encoding='utf-8', errors='ignore') as f:
        current_table = None
        cols = []
        for line in f:
            if line.startswith('INSERT INTO'):
                m = re.search(r'INSERT INTO `([^`]+)` \(([^)]+)\)', line)
                if m:
                    current_table = m.group(1)
                    cols = [c.strip(' `') for c in m.group(2).split(',')]
                continue
            if current_table and 'census' in current_table and line.strip().startswith('('):
                # Check if line contains augusta and 1880
                line_lower = line.lower()
                if 'augusta' in line_lower:
                    # check year or 1880
                    if '1880' in line:
                        results[(current_table, 'augusta', '1880')] = results.get((current_table, 'augusta', '1880'), 0) + 1

    print("Census tables matching Augusta + 1880:")
    for k, v in results.items():
        print(f"  {k}: {v}")
    if not results:
        print("  None found!")

if __name__ == '__main__':
    check_census_tables()
