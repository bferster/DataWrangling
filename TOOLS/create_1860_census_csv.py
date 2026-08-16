import os
import csv
import re

sql_path = os.path.join("Ed's data", "api-valley-newamericanhistory-org_20260630_14-54-02.sql")
output_csv = "1860Census.csv"

def parse_sql_values(line):
    values = []
    line = line.strip()
    if line.startswith('('):
        line = line[1:]
    if line.endswith('),') or line.endswith(');'):
        line = line[:-2]
    elif line.endswith(')'):
        line = line[:-1]
    
    n = len(line)
    i = 0
    while i < n:
        while i < n and line[i].isspace():
            i += 1
        if i >= n:
            break
        
        if line[i] == "'":
            i += 1
            val_chars = []
            while i < n:
                if line[i] == '\\' and i + 1 < n:
                    ch = line[i+1]
                    if ch == "'":
                        val_chars.append("'")
                    elif ch == '"':
                        val_chars.append('"')
                    elif ch == '\\':
                        val_chars.append('\\')
                    elif ch == 'n':
                        val_chars.append('\n')
                    elif ch == 'r':
                        val_chars.append('\r')
                    elif ch == 't':
                        val_chars.append('\t')
                    elif ch == '0':
                        val_chars.append('\0')
                    else:
                        val_chars.append(ch)
                    i += 2
                elif line[i] == "'":
                    if i + 1 < n and line[i+1] == "'":
                        val_chars.append("'")
                        i += 2
                    else:
                        i += 1
                        break
                else:
                    val_chars.append(line[i])
                    i += 1
            values.append("".join(val_chars))
            while i < n and line[i] != ',':
                i += 1
            if i < n and line[i] == ',':
                i += 1
        else:
            end = i
            while end < n and line[end] != ',':
                end += 1
            token = line[i:end].strip()
            if token.upper() == 'NULL':
                values.append('')
            else:
                values.append(token)
            i = end + 1

    return values

def export_1860_census():
    columns = []
    augusta_1860_rows = []
    in_pop = False

    print("Reading SQL dump file...")
    with open(sql_path, 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            if 'INSERT INTO `population_census` ' in line or line.startswith('INSERT INTO `population_census`'):
                in_pop = True
                cols_str = line[line.find('(')+1 : line.find(')')]
                columns = [c.strip(' `') for c in cols_str.split(',')]
                continue
            if in_pop:
                if line.startswith('UNLOCK TABLES') or line.startswith('DROP TABLE') or line.startswith('CREATE TABLE'):
                    in_pop = False
                    break
                stripped = line.strip()
                if stripped.startswith('('):
                    vals = parse_sql_values(stripped)
                    if len(vals) >= 3:
                        county = vals[1].lower()
                        year = str(vals[2])
                        if county == 'augusta' and year == '1860':
                            augusta_1860_rows.append(vals)

    print(f"Writing {len(augusta_1860_rows)} rows to {output_csv}...")
    with open(output_csv, 'w', encoding='utf-8', newline='') as out_f:
        writer = csv.writer(out_f)
        writer.writerow(columns)
        writer.writerows(augusta_1860_rows)

    print(f"Successfully generated {output_csv} with {len(augusta_1860_rows)} rows and {len(columns)} columns.")

if __name__ == '__main__':
    export_1860_census()
