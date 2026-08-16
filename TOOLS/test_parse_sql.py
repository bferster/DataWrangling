import os
import csv
import re

sql_path = os.path.join("Ed's data", "api-valley-newamericanhistory-org_20260630_14-54-02.sql")

def parse_sql_values(line):
    # Standard SQL tuple parser for a line like: (1,'augusta',1860,'Mary',NULL,'Carter',...)
    # Handles escaped quotes \' and NULL values
    values = []
    line = line.strip()
    if line.startswith('('):
        line = line[1:]
    if line.endswith('),') or line.endswith(');'):
        line = line[:-2]
    elif line.endswith(')'):
        line = line[:-1]
    
    # Parse SQL comma-separated values taking into account quoted strings
    n = len(line)
    i = 0
    while i < n:
        # Skip whitespace
        while i < n and line[i].isspace():
            i += 1
        if i >= n:
            break
        
        if line[i] == "'":
            # Quoted string
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
                    if i + 1 < n and line[i+1] == "'": # Escaped quote ''
                        val_chars.append("'")
                        i += 2
                    else:
                        i += 1 # End of string
                        break
                else:
                    val_chars.append(line[i])
                    i += 1
            values.append("".join(val_chars))
            # Skip past comma
            while i < n and line[i] != ',':
                i += 1
            if i < n and line[i] == ',':
                i += 1
        else:
            # Unquoted token (number, NULL, boolean, etc.)
            end = i
            while end < n and line[end] != ',':
                end += 1
            token = line[i:end].strip()
            if token.upper() == 'NULL':
                values.append('') # Or None, represented as empty string in CSV
            else:
                values.append(token)
            i = end + 1

    return values

def test():
    columns = []
    augusta_1860_rows = []
    in_pop = False

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

    print(f"Header ({len(columns)} cols):", columns)
    print(f"Extracted Augusta 1860 rows: {len(augusta_1860_rows)}")
    if augusta_1860_rows:
        print("Sample row 1:", augusta_1860_rows[0])
        print("Sample row last:", augusta_1860_rows[-1])

if __name__ == '__main__':
    test()
