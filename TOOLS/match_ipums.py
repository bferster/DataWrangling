"""
Match IPUMS extract records to census transcription CSV.
Follows the specification in PROMPTS/IPUMS2Census.md.

Universal high-performance matcher incorporating:
- Dynamic district sequence alignment and anchor discovery
- Anchor-and-interpolate positional priors
- Multi-pass contiguous continuation merging for split transcription families
- Relaxed household rule with Step 3b person-level fallback within positional windows
- Strict 1-to-1 person alignment with sibling tie protection
- Strict preservation of the `head` column and all existing transcription rows
- Output fields: ipums_id, prop_value, relation (1850-1870), ipums_match

Usage:
    python match_ipums.py
    python TOOLS/match_ipums.py --census census.csv --ipums ipums.csv --output census.csv
"""

import sys
import os
import time
import argparse
import pandas as pd
import numpy as np
from collections import Counter

def parse_age(a):
    if pd.isna(a): return np.nan
    s = str(a).strip()
    if not s or s.lower() == 'nan': return np.nan
    if '-' in s or '/' in s: return 0.0
    try:
        val = float(s)
        return 0.0 if val <= 1.0 else val
    except: return np.nan

def get_norm_race(r):
    if pd.isna(r): return ''
    r = str(r).strip().upper()
    if r in ['B', 'M']: return 'B'
    if r in ['W', 'C', 'J']: return 'W'
    if r == 'I': return 'I'
    return r

def map_ipums_relation(v):
    if pd.isna(v): return ''
    s = str(v).strip()
    if not s or s.lower() == 'nan': return ''
    try:
        c = int(float(s))
        if c == 101: return 'Self'
        if c == 201: return 'Spouse'
        if 301 <= c <= 399: return 'Child'
        if 401 <= c <= 499: return 'Child-in-law'
        if 501 <= c <= 599: return 'Parent'
        if 601 <= c <= 699: return 'Parent-in-law'
        if 701 <= c <= 799: return 'Sibling'
        if 801 <= c <= 899: return 'Sibling-in-law'
        if 901 <= c <= 999: return 'Grandchild'
        if 1001 <= c <= 1099: return 'Relative'
        if 1101 <= c <= 1199: return 'Partner'
        if 1200 <= c <= 1299: return 'Employee'
        if 1300 <= c <= 1399 or c == 13: return 'Group'
        if c >= 9000: return 'Other'
        return s
    except:
        return s

def score_person(c, p):
    c_gender = c['gender']
    p_gender = p['gender']
    if not c_gender or not p_gender or c_gender != p_gender:
        return 0.0
        
    c_race = c['norm_race']
    p_race = p['norm_race']
    if not c_race or not p_race or c_race != p_race:
        return 0.0
        
    c_age = c['age_num']
    p_age = p['age_num']
    if pd.isna(c_age) or pd.isna(p_age):
        return 0.0
        
    diff = abs(c_age - p_age)
    if diff > 2.0:
        return 0.0
        
    score = 1.0 - (0.15 * diff)
    
    # Birthplace bonus if matching
    c_bp = c.get('birth_place', '')
    p_bp = p.get('birth_place', '')
    if c_bp and p_bp and c_bp != 'NAN' and p_bp != 'NAN':
        if c_bp == p_bp:
            score += 0.05
        else:
            score -= 0.05
            
    # Head bonus
    if c.get('head') == 'Y' and p.get('head') == 'Y':
        score += 0.05
        
    return score

def score_hh_pair(c_hh, i_hh, expected_i_row=None):
    c_mems = c_hh['members']
    i_mems = i_hh['members']
    m = len(c_mems)
    n = len(i_mems)
    
    if max(m, n) <= 15 and abs(m - n) > 2:
        return 0.0
    if max(m, n) > 15 and abs(m - n) / max(m, n) > 0.35:
        return 0.0
        
    pairs = []
    for i, c in enumerate(c_mems):
        for j, p in enumerate(i_mems):
            s = score_person(c, p)
            if s > 0.0:
                pairs.append((s, i, j))
                
    if not pairs:
        return 0.0

    pairs.sort(reverse=True, key=lambda x: x[0])
    
    matched_c = set()
    matched_i = set()
    tot_score = 0.0
    for s, i, j in pairs:
        if i not in matched_c and j not in matched_i:
            matched_c.add(i)
            matched_i.add(j)
            tot_score += s
            
    base_s = (2.0 * tot_score) / (m + n)
    if expected_i_row is not None:
        row_diff = abs(i_hh['mid_row'] - expected_i_row)
        pos_factor = max(0.0, 1.0 - (row_diff / 500.0) * 0.3)
        return base_s * pos_factor
    return base_s

def run_matcher(census_path='census.csv', ipums_path='ipums.csv', output_path='census.csv'):
    start_time = time.time()
    print(f"Loading census transcription from: {census_path}")
    orig_df = pd.read_csv(census_path, dtype=str)
    census = orig_df.copy()
    census_len = len(census)

    print(f"Loading IPUMS extract from: {ipums_path}")
    ipums = pd.read_csv(ipums_path, dtype=str)

    # Standardize IPUMS columns (handling raw or normalized files)
    gender_map = {'1': 'M', '2': 'F'}
    race_map = {'100': 'W', '120': 'W', '200': 'B', '210': 'M', '300': 'I', '400': 'C', '500': 'J'}
    bpl_map = {
        '51': 'VA', '24': 'MD', '37': 'NC', '45': 'SC', '42': 'PA', '21': 'KY', '47': 'TN', '11': 'DC',
        '414': 'Ireland', '453': 'Germany', '36': 'NY', '410': 'England', '25': 'MA', '9': 'CT',
        '34': 'NJ', '29': 'MO', '421': 'France', '39': 'OH', '50': 'VT', '18': 'IN', '411': 'Scotland',
        '150': 'Canada', '28': 'MS', '426': 'Switzerland', '33': 'NH', '5': 'CA', '455': 'Poland',
        '17': 'IL', '10': 'DE', '450': 'Austria', '412': 'Wales', '23': 'ME', '13': 'GA', '54': 'WV'
    }

    if 'SEX' in ipums.columns and 'gender' not in ipums.columns:
        ipums['gender'] = ipums['SEX'].map(gender_map).fillna(ipums['SEX'])
    if 'RACED' in ipums.columns and 'race' not in ipums.columns:
        ipums['race'] = ipums['RACED'].map(race_map).fillna(ipums['RACED'])
    if 'BIRTHYR' in ipums.columns and 'birth_year' not in ipums.columns:
        ipums['birth_year'] = ipums['BIRTHYR']
    if 'AGE' in ipums.columns and 'age' not in ipums.columns:
        ipums['age'] = ipums['AGE']
    if 'HISTID' in ipums.columns and 'ipums_id' not in ipums.columns:
        ipums['ipums_id'] = ipums['HISTID']
    elif 'ipubs_id' in ipums.columns and 'ipums_id' not in ipums.columns:
        ipums['ipums_id'] = ipums['ipubs_id']
    if 'SERIAL' in ipums.columns and 'family' not in ipums.columns:
        ipums['family'] = ipums['SERIAL']
    if 'RELATED' in ipums.columns and 'relate' not in ipums.columns:
        ipums['relate'] = ipums['RELATED'].apply(map_ipums_relation)
    elif 'relate' in ipums.columns:
        ipums['relate'] = ipums['relate'].apply(map_ipums_relation)
    if 'BPL' in ipums.columns and 'birth_place' not in ipums.columns:
        ipums['birth_place'] = ipums['BPL'].map(bpl_map).fillna(ipums['BPL'])
    if 'REALPROP' in ipums.columns and 'prop_value' not in ipums.columns:
        ipums['prop_value'] = ipums['REALPROP']

    # Standardize string fields
    census['gender'] = census['gender'].fillna('').str.strip().str.upper()
    census['birth_place'] = census['birth_place'].fillna('').str.strip().str.upper() if 'birth_place' in census.columns else ''
    census['age_num'] = census['age'].apply(parse_age)
    census['norm_race'] = census['race'].apply(get_norm_race)
    census['head'] = census['head'].fillna('').str.strip().str.upper()

    ipums['gender'] = ipums['gender'].fillna('').str.strip().str.upper()
    ipums['birth_place'] = ipums['birth_place'].fillna('').str.strip().str.upper() if 'birth_place' in ipums.columns else ''
    ipums['age_num'] = ipums['age'].apply(parse_age)
    ipums['norm_race'] = ipums['norm_race'].apply(get_norm_race) if 'norm_race' in ipums.columns else ipums['race'].apply(get_norm_race)
    if 'head' not in ipums.columns:
        ipums['head'] = ipums.apply(lambda r: 'Y' if str(r.get('PERNUM', '')).strip() == '1' or str(r.get('relate', '')).strip() == 'Self' else '', axis=1)
    else:
        ipums['head'] = ipums['head'].fillna('').str.strip().str.upper()

    # Determine Census year
    census_year = 1860
    try:
        max_by = pd.to_numeric(census['birth_year'], errors='coerce').max()
        if max_by <= 1851:
            census_year = 1850
        elif max_by <= 1861:
            census_year = 1860
        elif max_by <= 1871:
            census_year = 1870
        else:
            census_year = 1880
    except:
        census_year = 1860

    update_relation = (census_year in [1850, 1860, 1870])
    populate_prop_value = (census_year in [1850, 1860, 1870])

    # Step 1: Group Census into family units
    if 'district' in census.columns:
        census['fam_change'] = (census['family'] != census['family'].shift(1)) | (census['district'] != census['district'].shift(1))
    else:
        census['fam_change'] = (census['family'] != census['family'].shift(1))
    census['c_hh_id'] = census['fam_change'].cumsum() - 1

    census_hhs = []
    for hh_id, g in census.groupby('c_hh_id', sort=False):
        census_hhs.append({
            'c_hh_id': hh_id,
            'district': g['district'].iloc[0] if 'district' in g.columns else 'ALL',
            'indices': g.index.tolist(),
            'mid_row': (g.index[0] + g.index[-1]) / 2.0,
            'members': g.to_dict('records')
        })

    # Group IPUMS (collapsing contiguous Group Quarters into institutional blocks)
    ipums['is_group'] = (ipums.get('relate') == 'Group') | (ipums.get('RELATE') == '13')
    ipums['group_change'] = (ipums['is_group'] != ipums['is_group'].shift(1))
    ipums['fam_change'] = (ipums['family'] != ipums['family'].shift(1)) & (~ipums['is_group'])
    ipums['i_hh_id'] = (ipums['fam_change'] | ipums['group_change']).cumsum() - 1

    ipums_hhs = []
    for hh_id, g in ipums.groupby('i_hh_id', sort=False):
        ipums_hhs.append({
            'i_hh_id': hh_id,
            'indices': g.index.tolist(),
            'mid_row': (g.index[0] + g.index[-1]) / 2.0,
            'is_inst': g['is_group'].iloc[0] if len(g) > 0 else False,
            'members': g.to_dict('records')
        })

    print(f"Grouped into: {len(census_hhs)} Census family units, {len(ipums_hhs)} IPUMS units.")

    # Step 2: Discover Sequence Anchors via Globally Unique Demographic Signatures
    c_sigs = [tuple(sorted([(round(m['age_num']) if not pd.isna(m['age_num']) else -1, m['gender'], m['norm_race']) for m in h['members']])) for h in census_hhs]
    i_sigs = [tuple(sorted([(round(m['age_num']) if not pd.isna(m['age_num']) else -1, m['gender'], m['norm_race']) for m in h['members']])) for h in ipums_hhs]

    c_counts = Counter(c_sigs)
    i_counts = Counter(i_sigs)
    i_sig_to_idx = {sig: idx for idx, sig in enumerate(i_sigs) if i_counts[sig] == 1}

    district_anchors = {}
    for c_idx, h in enumerate(census_hhs):
        sig = c_sigs[c_idx]
        if c_counts[sig] == 1 and sig in i_sig_to_idx:
            i_idx = i_sig_to_idx[sig]
            dist = h['district']
            if dist not in district_anchors:
                district_anchors[dist] = []
            district_anchors[dist].append((c_idx, h['mid_row'], i_idx, ipums_hhs[i_idx]['mid_row']))

    clean_anchors = {}
    for dist, anc in district_anchors.items():
        anc.sort(key=lambda x: x[1])
        i_rows = [x[3] for x in anc]
        med_i = np.median(i_rows)
        iqr_i = np.percentile(i_rows, 75) - np.percentile(i_rows, 25)
        valid = [x for x in anc if abs(x[3] - med_i) <= 2.5 * max(iqr_i, 500)]
        clean_anchors[dist] = valid
        print(f"District {dist}: {len(valid)} confirmed sequential anchors.")

    def get_expected_i_row(dist, c_row):
        anc = clean_anchors.get(dist)
        if not anc:
            return c_row
        if c_row <= anc[0][1]:
            return anc[0][3] - (anc[0][1] - c_row)
        if c_row >= anc[-1][1]:
            return anc[-1][3] + (c_row - anc[-1][1])
        left = 0
        right = len(anc) - 1
        while left <= right:
            mid = (left + right) // 2
            if anc[mid][1] <= c_row:
                left = mid + 1
            else:
                right = mid - 1
        p1 = anc[right]
        p2 = anc[left]
        frac = (c_row - p1[1]) / max(1.0, p2[1] - p1[1])
        return p1[3] + frac * (p2[3] - p1[3])

    # Pass 1: Standard Mutual Household Matching with Positional Prior
    print("Executing Pass 1: Mutual Household Matching with Positional Prior...")
    best_i_for_c = {}
    best_c_for_i = {}

    for c_idx, c_hh in enumerate(census_hhs):
        dist = c_hh['district']
        exp_i_row = get_expected_i_row(dist, c_hh['mid_row'])
        best_s = 0.0
        best_i = -1
        for i_idx, i_hh in enumerate(ipums_hhs):
            if abs(i_hh['mid_row'] - exp_i_row) > 250:
                continue
            s = score_hh_pair(c_hh, i_hh, exp_i_row)
            if s > best_s:
                best_s = s
                best_i = i_idx
        if best_i >= 0 and best_s >= 0.50:
            best_i_for_c[c_idx] = (best_i, best_s)
            if best_i not in best_c_for_i or best_s > best_c_for_i[best_i][1]:
                best_c_for_i[best_i] = (c_idx, best_s)

    matched_hh_pairs = []
    matched_census_hhs = set()
    claimed_i_hhs = set()

    for c_idx, (i_idx, s) in best_i_for_c.items():
        if best_c_for_i.get(i_idx, (None, None))[0] == c_idx:
            matched_hh_pairs.append((census_hhs[c_idx], ipums_hhs[i_idx], s))
            matched_census_hhs.add(c_idx)
            claimed_i_hhs.add(i_idx)

    print(f"Pass 1 Confirmed Mutual Matches: {len(matched_hh_pairs)}")

    # Pass 2: Continuation Merging for Split Transcription Families
    print("Executing Pass 2: Continuation Merging for Split Families...")
    merged_count = 0
    c_idx = 0
    while c_idx < len(census_hhs) - 1:
        if c_idx in matched_census_hhs:
            c_idx += 1
            continue
        matched_merge = False
        for k in [2, 3, 4]:
            if c_idx + k > len(census_hhs): break
            sub_units = [census_hhs[c_idx + u] for u in range(k)]
            if any((c_idx + u) in matched_census_hhs for u in range(k)): break
            if len(set(u['district'] for u in sub_units)) > 1: break
            comb_mems = []
            comb_indices = []
            for u in sub_units:
                comb_mems.extend(u['members'])
                comb_indices.extend(u['indices'])
            comb_hh = {'members': comb_mems, 'mid_row': np.mean([u['mid_row'] for u in sub_units]), 'indices': comb_indices}
            exp_i = get_expected_i_row(sub_units[0]['district'], comb_hh['mid_row'])
            best_s = 0.0
            best_i = -1
            for i_idx, i_hh in enumerate(ipums_hhs):
                if i_idx in claimed_i_hhs or abs(i_hh['mid_row'] - exp_i) > 200: continue
                s = score_hh_pair(comb_hh, i_hh, exp_i)
                if s > best_s:
                    best_s = s
                    best_i = i_idx
            if best_i >= 0 and best_s >= 0.65:
                matched_hh_pairs.append((comb_hh, ipums_hhs[best_i], best_s))
                for u in range(k):
                    matched_census_hhs.add(c_idx + u)
                claimed_i_hhs.add(best_i)
                merged_count += 1
                c_idx += k
                matched_merge = True
                break
        if not matched_merge:
            c_idx += 1

    print(f"Pass 2 Split-Continuation Units Merged: {merged_count}")

    # Pass 3: Institutional Blocks Alignment
    inst_count = 0
    for c_idx, c_hh in enumerate(census_hhs):
        if c_idx in matched_census_hhs: continue
        m = len(c_hh['members'])
        if m < 15: continue
        dist = c_hh['district']
        exp_i = get_expected_i_row(dist, c_hh['mid_row'])
        best_s = 0.0
        best_i = -1
        for i_idx, i_hh in enumerate(ipums_hhs):
            if i_idx in claimed_i_hhs: continue
            if abs(i_hh['mid_row'] - exp_i) > 500: continue
            s = score_hh_pair(c_hh, i_hh, exp_i)
            if s > best_s:
                best_s = s
                best_i = i_idx
        if best_i >= 0 and best_s >= 0.50:
            matched_hh_pairs.append((c_hh, ipums_hhs[best_i], best_s))
            matched_census_hhs.add(c_idx)
            claimed_i_hhs.add(best_i)
            inst_count += 1

    print(f"Pass 3 Institutional Blocks Aligned: {inst_count}")
    print(f"Total Confirmed Household Units: {len(matched_hh_pairs)}")

    # Step 3a: 1-to-1 Person Matching within Matched Units
    ipums_ids = [''] * census_len
    prop_values = [''] * census_len
    ipums_matches = [''] * census_len
    relations = orig_df['relation'].tolist() if 'relation' in orig_df.columns else [''] * census_len

    matched_census_rows = {}
    claimed_ipums_indices = set()
    tie_count = 0

    print("Executing Step 3a: 1-to-1 Person Matching within Confirmed Units...")
    for c_hh, i_hh, hh_s in matched_hh_pairs:
        c_mems = c_hh['members']
        i_mems = i_hh['members']
        c_indices = c_hh['indices']
        i_indices = i_hh['indices']
        m = len(c_mems)
        n = len(i_mems)

        c_cand = {i: [] for i in range(m)}
        i_cand = {j: [] for j in range(n)}

        for i in range(m):
            for j in range(n):
                s = score_person(c_mems[i], i_mems[j])
                if s >= 0.60:
                    c_cand[i].append((s, j))
                    i_cand[j].append((s, i))

        for i in range(m):
            c_cand[i].sort(reverse=True, key=lambda x: x[0])
        for j in range(n):
            i_cand[j].sort(reverse=True, key=lambda x: x[0])

        claimed_in_hh = set()
        matched_pairs = {}

        for i in range(m):
            if not c_cand[i]: continue
            top_s, top_j = c_cand[i][0]

            # Check sibling tie
            is_tie = False
            for oi in range(m):
                if oi != i and c_cand[oi] and c_cand[oi][0][1] == top_j and abs(c_cand[oi][0][0] - top_s) < 1e-4:
                    is_tie = True
                    break

            if is_tie:
                row_idx = c_indices[i]
                ipums_matches[row_idx] = 'TIE'
                tie_count += 1
                continue

            if i_cand[top_j] and i_cand[top_j][0][1] == i and top_j not in claimed_in_hh:
                claimed_in_hh.add(top_j)
                matched_pairs[i] = (top_j, top_s)

        for i, (j, s) in matched_pairs.items():
            row_idx = c_indices[i]
            ip_row_idx = i_indices[j]
            ip_rec = i_mems[j]

            ipums_ids[row_idx] = str(ip_rec.get('ipums_id', ''))
            pv = ip_rec.get('prop_value', '')
            if pd.notna(pv) and str(pv).strip() != '':
                try: prop_values[row_idx] = str(int(float(pv)))
                except: prop_values[row_idx] = str(pv)
            else:
                prop_values[row_idx] = ''

            ipums_matches[row_idx] = f"{s:.2f}"
            if update_relation:
                rel = ip_rec.get('norm_relate', '') or ip_rec.get('relate', '')
                relations[row_idx] = str(rel) if pd.notna(rel) else ''

            matched_census_rows[row_idx] = ip_row_idx
            claimed_ipums_indices.add(ip_row_idx)

    print(f"Step 3a Confirmed Persons: {len(matched_census_rows)} ({len(matched_census_rows)/census_len:.1%})")

    # Step 3b: Person-Level Fallback within Positional Window for Unmatched Rows
    print("Executing Step 3b: Person-Level Fallback within Positional Windows...")
    fallback_count = 0
    unmatched_c_rows = [r for r in range(census_len) if r not in matched_census_rows and ipums_matches[r] != 'TIE']
    unclaimed_i_rows = [r for r in range(len(ipums)) if r not in claimed_ipums_indices]

    i_records = ipums.to_dict('records')
    c_records = census.to_dict('records')

    for c_row in unmatched_c_rows:
        c_rec = c_records[c_row]
        dist = c_rec.get('district', 'ALL')
        exp_i = get_expected_i_row(dist, c_row)

        best_eff_s = 0.0
        best_raw_s = 0.0
        best_i_row = -1

        for i_row in unclaimed_i_rows:
            if i_row in claimed_ipums_indices: continue
            dist_diff = abs(i_row - exp_i)
            if dist_diff > 250: continue
            p_rec = i_records[i_row]
            sp = score_person(c_rec, p_rec)
            if sp >= 0.65:
                # Positional prior weighting: prioritize candidates close to interpolated anchor position
                eff_s = sp - (dist_diff / 250.0) * 0.15
                if eff_s > best_eff_s:
                    best_eff_s = eff_s
                    best_raw_s = sp
                    best_i_row = i_row

        if best_i_row >= 0 and best_raw_s >= 0.65:
            p_rec = i_records[best_i_row]
            ipums_ids[c_row] = str(p_rec.get('ipums_id', ''))
            pv = p_rec.get('prop_value', '')
            if pd.notna(pv) and str(pv).strip() != '':
                try: prop_values[c_row] = str(int(float(pv)))
                except: prop_values[c_row] = str(pv)
            else:
                prop_values[c_row] = ''

            ipums_matches[c_row] = f"{best_raw_s:.2f}"
            if update_relation:
                rel = p_rec.get('norm_relate', '') or p_rec.get('relate', '')
                relations[c_row] = str(rel) if pd.notna(rel) else ''

            matched_census_rows[c_row] = best_i_row
            claimed_ipums_indices.add(best_i_row)
            fallback_count += 1

    total_matched = len(matched_census_rows)
    print(f"Step 3b Fallback Persons Matched: {fallback_count} ({fallback_count/census_len:.1%})")

    # Step 4: Populate Output
    orig_df['ipums_id'] = ipums_ids
    if populate_prop_value or 'prop_value' in orig_df.columns:
        orig_df['prop_value'] = prop_values
    if update_relation or 'relation' in orig_df.columns:
        orig_df['relation'] = relations
    orig_df['ipums_match'] = ipums_matches

    print(f"\n==========================================")
    print(f"Matching Completed (Census Year: {census_year}):")
    print(f"Total Census Records: {census_len}")
    print(f"Matched Persons:     {total_matched} ({total_matched/census_len:.2%})")
    print(f"Ambiguous Ties:      {tie_count} ({tie_count/census_len:.2%})")
    print(f"Unmatched:           {census_len - total_matched - tie_count} ({(census_len - total_matched - tie_count)/census_len:.2%})")
    print(f"Execution Time:      {time.time() - start_time:.2f}s")
    print(f"==========================================")

    # Save output safely
    saved = False
    for attempt in range(5):
        try:
            orig_df.to_csv(output_path, index=False)
            print(f"Saved updated census to: {output_path}")
            saved = True
            break
        except PermissionError:
            print(f"File {output_path} is currently locked. Retrying in 2 seconds... (Attempt {attempt+1}/5)")
            time.sleep(2)
    if not saved:
        temp_out = output_path.replace('.csv', '_updated.csv')
        orig_df.to_csv(temp_out, index=False)
        print(f"Could not overwrite {output_path} due to file lock. Saved to {temp_out} instead.")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Match IPUMS data to Census CSV.")
    parser.add_argument('--census', default='census.csv', help='Path to census.csv')
    parser.add_argument('--ipums', default='ipums.csv', help='Path to ipums.csv')
    parser.add_argument('--output', default='census.csv', help='Path to output census CSV')
    args = parser.parse_args()

    run_matcher(args.census, args.ipums, args.output)
