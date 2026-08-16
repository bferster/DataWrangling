import os
import re

sql_path = os.path.join("Ed's data", "api-valley-newamericanhistory-org_20260630_14-54-02.sql")

def search_1880():
    table_year_counts = {}
    with open(sql_path, 'r', encoding='utf-8', errors='ignore') as f:
        current_table = None
        for line in f:
            if line.startswith('INSERT INTO'):
                match = re.search(r'INSERT INTO `([^`]+)`', line)
                if match:
                    current_table = match.group(1)
                continue
            
            if current_table and line.strip().startswith('('):
                if '1880' in line:
                    key = (current_table, 'contains 1880')
                    table_year_counts[key] = table_year_counts.get(key, 0) + 1

    print("Tables containing '1880':")
    for k, v in table_year_counts.items():
        print(f"  Table '{k[0]}': {v} rows containing '1880'")

if __name__ == '__main__':
    search_1880()
