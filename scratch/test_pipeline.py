import sys
import os
import time
import pandas as pd
import numpy as np
from collections import Counter

print("Loading files...")
t0 = time.time()
census = pd.read_csv('census.csv', dtype=str)
census_len = len(census)
ipums = pd.read_csv('ipums.csv', dtype=str)

# Map raw IPUMS if needed
gender_map = {'1': 'M', '2': 'F'}
race_map = {'100': 'W', '120': 'W', '200': 'B', '210': 'M', '300': 'I', '400': 'C', '500': 'J'}
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
if 'SERIAL' in ipums.columns and 'family' not in ipums.columns:
    ipums['family'] = ipums['SERIAL']
if 'RELATED' in ipums.columns and 'relate' not in ipums.columns:
    def map_rel(v):
        try:
            c = int(float(v))
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
            return 'Other'
        except: return str(v)
    ipums['relate'] = ipums['RELATED'].apply(map_rel)

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

census['gender'] = census['gender'].fillna('').str.strip().str.upper()
census['age_num'] = census['age'].apply(parse_age)
census['norm_race'] = census['race'].apply(get_norm_race)

ipums['gender'] = ipums['gender'].fillna('').str.strip().str.upper()
ipums['age_num'] = ipums['age'].apply(parse_age)
ipums['norm_race'] = ipums['race'].apply(get_norm_race)

# Group Census
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

# Group IPUMS
ipums['is_group'] = (ipums['relate'] == 'Group') | (ipums.get('RELATE') == '13')
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

print(f"Census units: {len(census_hhs)}, IPUMS units: {len(ipums_hhs)}")

# Step 2: Discover District Segment Alignment dynamically via Unique Anchors
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
    print(f"District {dist}: {len(valid)} verified sequential anchors.")

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

def score_person(c, p):
    if c['gender'] != p['gender'] or c['norm_race'] != p['norm_race']:
        return 0.0
    c_a, p_a = c['age_num'], p['age_num']
    if pd.isna(c_a) or pd.isna(p_a):
        return 0.0
    diff = abs(c_a - p_a)
    if diff > 2.0:
        return 0.0
    s = 1.0 - 0.15 * diff
    if c.get('birth_place') and p.get('birth_place') and c['birth_place'] == p['birth_place']:
        s += 0.05
    if c.get('head') == 'Y' and p.get('head') == 'Y':
        s += 0.05
    return s

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
    tot_s = 0.0
    for s, i, j in pairs:
        if i not in matched_c and j not in matched_i:
            matched_c.add(i)
            matched_i.add(j)
            tot_s += s
    base_s = (2.0 * tot_s) / (m + n)
    if expected_i_row is not None:
        row_diff = abs(i_hh['mid_row'] - expected_i_row)
        pos_factor = max(0.0, 1.0 - (row_diff / 500.0) * 0.3)
        return base_s * pos_factor
    return base_s

print("Running Pass 1: Standard Mutual Household Matching...")
best_i_for_c = {}
best_c_for_i = {}

for c_idx, c_hh in enumerate(census_hhs):
    dist = c_hh['district']
    exp_i_row = get_expected_i_row(dist, c_hh['mid_row'])
    c_mems = c_hh['members']
    m = len(c_mems)
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

print(f"Pass 1 Mutual Household Matches: {len(matched_hh_pairs)}")

print("Running Pass 2: Continuation Merging...")
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

print(f"Pass 2 Merged continuation units: {merged_count}")
print(f"Total matched household units: {len(matched_hh_pairs)}")

# Institutional blocks alignment
print("Running Pass 3: Institutional Blocks Alignment...")
inst_matches = 0
for c_idx, c_hh in enumerate(census_hhs):
    if c_idx in matched_census_hhs: continue
    m = len(c_hh['members'])
    if m < 15: continue
    dist = c_hh['district']
    exp_i = get_expected_i_row(dist, c_hh['mid_row'])
    # Find matching GQ block in IPUMS
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
        inst_matches += 1

print(f"Pass 3 Institutional blocks aligned: {inst_matches}")

matched_census_rows = {} # c_row -> (i_row, score)
claimed_ipums_rows = set()

# Step 3a: Person matching within matched units
for c_hh, i_hh, s in matched_hh_pairs:
    c_mems = c_hh['members']
    i_mems = i_hh['members']
    c_indices = c_hh['indices']
    i_indices = i_hh['indices']
    pairs = []
    for i, c in enumerate(c_mems):
        for j, p in enumerate(i_mems):
            sp = score_person(c, p)
            if sp >= 0.60:
                pairs.append((sp, i, j))
    pairs.sort(reverse=True, key=lambda x: x[0])
    claimed_i = set()
    for sp, i, j in pairs:
        c_row = c_indices[i]
        i_row = i_indices[j]
        if c_row not in matched_census_rows and i_row not in claimed_ipums_rows and j not in claimed_i:
            matched_census_rows[c_row] = (i_row, sp)
            claimed_ipums_rows.add(i_row)
            claimed_i.add(j)

print(f"Step 3a matched persons: {len(matched_census_rows)} ({len(matched_census_rows)/census_len:.1%})")

# Step 3b: Person-level fallback within positional window
fallback_count = 0
unmatched_c_rows = [r for r in range(census_len) if r not in matched_census_rows]
unclaimed_i_rows = [r for r in range(len(ipums)) if r not in claimed_ipums_rows]

i_records = ipums.to_dict('records')
c_records = census.to_dict('records')

for c_row in unmatched_c_rows:
    c_rec = c_records[c_row]
    dist = c_rec.get('district', 'ALL')
    exp_i = get_expected_i_row(dist, c_row)
    best_sp = 0.0
    best_i_row = -1
    for i_row in unclaimed_i_rows:
        if i_row in claimed_ipums_rows: continue
        if abs(i_row - exp_i) > 200: continue
        p_rec = i_records[i_row]
        sp = score_person(c_rec, p_rec)
        if sp > best_sp:
            best_sp = sp
            best_i_row = i_row
    if best_i_row >= 0 and best_sp >= 0.65:
        matched_census_rows[c_row] = (best_i_row, best_sp)
        claimed_ipums_rows.add(best_i_row)
        fallback_count += 1

print(f"Step 3b Fallback matched persons: {fallback_count} ({fallback_count/census_len:.1%})")
total_matched = len(matched_census_rows)
print(f"\n==========================================")
print(f"TOTAL MATCHED PERSONS: {total_matched} / {census_len} ({total_matched/census_len:.2%})")
print(f"Total time elapsed: {time.time() - t0:.2f}s")
print(f"==========================================")
