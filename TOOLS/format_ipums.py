"""
Format and normalize raw IPUMS extract (ipubs.csv) into ipums.csv.
Follows the specification in PROMPTS/FormatIPUMSdata.md.

Usage:
    python TOOLS/format_ipums.py
    python TOOLS/format_ipums.py --input ipubs.csv --output ipums.csv
"""

import sys
import os
import argparse
import pandas as pd
import numpy as np

def format_ipums(input_path='ipums.csv', output_path='ipums.csv'):
    if not os.path.exists(input_path) and os.path.exists('ipubs.csv'):
        input_path = 'ipubs.csv'
    print(f"Loading raw IPUMS extract from: {input_path}")
    raw_df = pd.read_csv(input_path, dtype=str)

    rename_map = {
        'SEX': 'gender',
        'RELATED': 'relate',
        'BIRTHYR': 'birth_year',
        'RACED': 'race',
        'BPL': 'birth_place',
        'REALPROP': 'prop_value',
        'HISTID': 'ipubs_id',
        'SERIAL': 'family',
        'PERNUM': 'person_num',
        'AGE': 'age',
        'DWELLING': 'dwelling'
    }

    gender_map = {'1': 'M', '2': 'F'}
    race_map = {
        '100': 'W', '120': 'W', '200': 'B', '210': 'M', '300': 'I', '400': 'C', '500': 'J'
    }
    def map_relate(val):
        if pd.isna(val): return ''
        s = str(val).strip()
        if not s: return ''
        try:
            code = int(float(s))
        except:
            return s
            
        if code == 101: return 'Self'
        if code == 201: return 'Spouse'
        if 301 <= code <= 399: return 'Child'
        if 401 <= code <= 499: return 'Child-in-law'
        if 501 <= code <= 599: return 'Parent'
        if 601 <= code <= 699: return 'Parent-in-law'
        if 701 <= code <= 799: return 'Sibling'
        if 801 <= code <= 899: return 'Sibling-in-law'
        if 901 <= code <= 999: return 'Grandchild'
        if 1001 <= code <= 1099: return 'Relative'
        if 1101 <= code <= 1199: return 'Partner'
        if 1200 <= code <= 1299: return 'Employee'
        if 1300 <= code <= 1399: return 'Group'
        if code >= 9000: return 'Other'
        return s

    bpl_map = {
        '51': 'VA', '24': 'MD', '37': 'NC', '45': 'SC', '42': 'PA', '21': 'KY', '47': 'TN', '11': 'DC',
        '414': 'Ireland', '453': 'Germany', '36': 'NY', '410': 'England', '25': 'MA', '9': 'CT',
        '34': 'NJ', '29': 'MO', '421': 'France', '39': 'OH', '50': 'VT', '18': 'IN', '411': 'Scotland',
        '150': 'Canada', '28': 'MS', '426': 'Switzerland', '33': 'NH', '5': 'CA', '455': 'Poland',
        '17': 'IL', '10': 'DE', '450': 'Austria', '412': 'Wales', '23': 'ME', '13': 'GA', '54': 'WV'
    }

    cols_to_drop = ['YEAR', 'HHWT', 'SAMPLE', 'RACE', 'RELATE', 'GQ', 'PERWT', 'STATEICP', 'COUNTYICP', 'VERSIONHIST', 'BPLD']
    df = raw_df.drop(columns=[c for c in cols_to_drop if c in raw_df.columns])
    df = df.rename(columns=rename_map)

    # Translate codes
    df['gender'] = df['gender'].map(gender_map).fillna(df['gender'])
    df['race'] = df['race'].map(race_map).fillna(df['race'])
    df['relate'] = df['relate'].apply(map_relate)
    df['birth_place'] = df['birth_place'].map(bpl_map).fillna(df['birth_place'])

    # Normalize race
    def get_norm_race(r):
        if pd.isna(r): return ''
        r = str(r).strip().upper()
        if r in ['B', 'M']: return 'B'
        if r in ['W', 'C', 'J']: return 'W'
        if r == 'I': return 'I'
        return r

    df['norm_race'] = df['race'].apply(get_norm_race)
    df['norm_relate'] = df['relate']
    df['norm_birth_place'] = df['birth_place']

    # Set head
    df['head'] = df['relate'].apply(lambda x: 'Y' if str(x).strip() == 'Self' else '')

    print(f"Total processed rows: {len(df)}")
    print(f"Total household heads: {(df['head'] == 'Y').sum()}")
    print("Norm race counts:\n", df['norm_race'].value_counts())
    print("Relate counts:\n", df['relate'].value_counts())

    df.to_csv(output_path, index=False)
    print(f"Saved normalized data to: {output_path}")

if __name__ == '__main__':
    default_input = 'ipubs.csv' if os.path.exists('ipubs.csv') else 'ipums.csv'
    parser = argparse.ArgumentParser(description="Format IPUMS raw extract data into normalized ipums.csv.")
    parser.add_argument('--input', default=default_input, help='Path to raw IPUMS extract')
    parser.add_argument('--output', default='ipums.csv', help='Path to output ipums.csv')
    args = parser.parse_args()

    format_ipums(args.input, args.output)
