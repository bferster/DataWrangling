"""
Match IPUMS extract records to census transcription CSV.
Follows the specification in PROMPTS/IPUMS2Census.md.

Universal high-performance matcher for 1850, 1860, 1870, and 1880 datasets.
Includes:
- Universal inverted demographic indexing
- Multi-pass contiguous continuation merging for split transcription families
- Institutional block anchoring & facility pool alignment for large institutions (Asylums, Boarding Schools)
- Strict 1-to-1 person alignment with tie protection
- Strict preservation of the `head` column across all census years

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

def parse_age(a):
    if pd.isna(a): return np.nan
    s = str(a).strip()
    if not s or s.lower() == 'nan': return np.nan
    if '-' in s or '/' in s:
        return 0.0
    try:
        val = float(s)
        if val <= 1.0:
            return 0.0
        return val
    except:
        return np.nan

def get_norm_race(r):
    if pd.isna(r): return ''
    r = str(r).strip().upper()
    if r in ['B', 'M']: return 'B'
    if r in ['W', 'C', 'J']: return 'W'
    if r == 'I': return 'I'
    return r

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
    
    # Birthplace check
    c_bp = c['birth_place']
    p_bp = p['birth_place']
    if c_bp and p_bp and c_bp != 'NAN' and p_bp != 'NAN':
        if c_bp == p_bp:
            score += 0.05
        else:
            score -= 0.05
            
    # Head check
    if c.get('head') == 'Y' and p.get('head') == 'Y':
        score += 0.05
        
    return score

def score_hh_pair(c_hh, i_hh):
    c_mems = c_hh['members']
    i_mems = i_hh['members']
    m = len(c_mems)
    n = len(i_mems)
    
    if max(m, n) <= 15 and abs(m - n) > 2:
        return 0.0
    if max(m, n) > 15 and abs(m - n) / max(m, n) > 0.25:
        return 0.0
        
    # Fast bipartite greedy matching
    pairs = []
    for i in range(m):
        c = c_mems[i]
        c_g, c_r, c_a = c['gender'], c['norm_race'], c['age_num']
        if not c_g or not c_r or pd.isna(c_a):
            continue
        for j in range(n):
            p = i_mems[j]
            if c_g == p['gender'] and c_r == p['norm_race']:
                p_a = p['age_num']
                if not pd.isna(p_a) and abs(c_a - p_a) <= 2.0:
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
            
    return (2.0 * tot_score) / (m + n)

def run_matcher(census_path='census.csv', ipums_path='ipums.csv', output_path='census.csv'):
    print(f"Loading census from: {census_path}")
    orig_df = pd.read_csv(census_path, dtype=str)
    census = orig_df.copy()
    census_len = len(census)

    print(f"Loading IPUMS from: {ipums_path}")
    ipums = pd.read_csv(ipums_path, dtype=str)

    # Standardize string fields
    census['gender'] = census['gender'].fillna('').str.strip().str.upper()
    census['birth_place'] = census['birth_place'].fillna('').str.strip().str.upper()
    census['age_num'] = census['age'].apply(parse_age)
    census['norm_race'] = census['race'].apply(get_norm_race)
    census['head'] = census['head'].fillna('').str.strip().str.upper()

    ipums['gender'] = ipums['gender'].fillna('').str.strip().str.upper()
    ipums['birth_place'] = ipums['birth_place'].fillna('').str.strip().str.upper()
    ipums['age_num'] = ipums['age'].apply(parse_age)
    ipums['norm_race'] = ipums['norm_race'].apply(get_norm_race) if 'norm_race' in ipums.columns else ipums['race'].apply(get_norm_race)
    ipums['head'] = ipums['head'].fillna('').str.strip().str.upper() if 'head' in ipums.columns else ipums['relate'].apply(lambda x: 'Y' if str(x).strip() == 'Self' else '')

    # Step 1: Group Census Households (Forward-fill within district)
    if 'district' in census.columns:
        census['fam_filled'] = census.groupby('district')['family'].ffill().bfill().fillna('1')
        census['fam_change'] = (census['fam_filled'] != census['fam_filled'].shift(1)) | (census['district'] != census['district'].shift(1))
    else:
        census['fam_filled'] = census['family'].ffill().bfill().fillna('1')
        census['fam_change'] = (census['fam_filled'] != census['fam_filled'].shift(1))
    census['hh_idx'] = census['fam_change'].cumsum() - 1

    census_hhs = []
    for hh_id, g in census.groupby('hh_idx', sort=False):
        census_hhs.append({
            'hh_idx': hh_id,
            'indices': g.index.tolist(),
            'mid_row': (g.index[0] + g.index[-1]) / 2.0,
            'members': g.to_dict('records')
        })

    # Group IPUMS (collapsing contiguous Group Quarters into institutional blocks)
    ipums['is_group'] = ipums['relate'] == 'Group'
    ipums['group_change'] = (ipums['is_group'] != ipums['is_group'].shift(1))
    ipums['fam_change'] = (ipums['family'] != ipums['family'].shift(1)) & (~ipums['is_group'])
    ipums['hh_change'] = ipums['fam_change'] | ipums['group_change']
    ipums['hh_idx'] = ipums['hh_change'].cumsum() - 1

    ipums_hhs = []
    for hh_id, g in ipums.groupby('hh_idx', sort=False):
        is_inst = g['is_group'].iloc[0] if len(g) > 0 else False
        ipums_hhs.append({
            'hh_idx': hh_id,
            'is_inst': is_inst,
            'indices': g.index.tolist(),
            'mid_row': (g.index[0] + g.index[-1]) / 2.0,
            'members': g.to_dict('records')
        })

    print(f"Census households: {len(census_hhs)}, IPUMS households: {len(ipums_hhs)}")

    # Step 2: Build high-speed candidate index for IPUMS households
    ipums_index = {}
    for i_idx, i_hh in enumerate(ipums_hhs):
        for p in i_hh['members']:
            g, r, a = p['gender'], p['norm_race'], p['age_num']
            if g and r and not pd.isna(a):
                b_age = int(a // 3)
                for ba in [b_age - 1, b_age, b_age + 1]:
                    key = (g, r, ba)
                    if key not in ipums_index:
                        ipums_index[key] = []
                    ipums_index[key].append(i_idx)

    # Pass 1: Standard Mutual Best Household Matching
    best_i_for_c = {}
    best_c_for_i = {}

    for c_idx, c_hh in enumerate(census_hhs):
        c_mems = c_hh['members']
        m = len(c_mems)
        candidate_set = set()
        
        for c in c_mems:
            g, r, a = c['gender'], c['norm_race'], c['age_num']
            if g and r and not pd.isna(a):
                key = (g, r, int(a // 3))
                if key in ipums_index:
                    candidate_set.update(ipums_index[key])
                    
        best_s = 0.0
        best_i = -1
        for i_idx in candidate_set:
            i_hh = ipums_hhs[i_idx]
            n = len(i_hh['members'])
            if max(m, n) <= 15 and abs(m - n) > 2:
                continue
            if max(m, n) > 15 and abs(m - n) / max(m, n) > 0.25:
                continue
                
            s = score_hh_pair(c_hh, i_hh)
            if s > best_s:
                best_s = s
                best_i = i_idx
                
        if best_i >= 0 and best_s >= 0.50:
            best_i_for_c[c_idx] = (best_i, best_s)
            if best_i not in best_c_for_i or best_s > best_c_for_i[best_i][1]:
                best_c_for_i[best_i] = (c_idx, best_s)

    matched_hh_pairs = [] # (c_hh, i_hh, score)
    matched_census_hhs = set()
    claimed_i_hhs = set()

    for c_idx, (i_idx, s) in best_i_for_c.items():
        if best_c_for_i.get(i_idx, (None, None))[0] == c_idx:
            matched_hh_pairs.append((census_hhs[c_idx], ipums_hhs[i_idx], s))
            matched_census_hhs.add(c_idx)
            claimed_i_hhs.add(i_idx)

    print(f"Pass 1 Mutual Household Matches: {len(matched_hh_pairs)}")

    # Pass 2: Contiguous continuation merging for split transcription families
    c_idx = 0
    merged_count = 0
    while c_idx < len(census_hhs) - 1:
        if c_idx in matched_census_hhs:
            c_idx += 1
            continue
        next_idx = c_idx + 1
        if next_idx in matched_census_hhs:
            c_idx += 1
            continue
            
        c1 = census_hhs[c_idx]
        c2 = census_hhs[next_idx]
        comb_mems = c1['members'] + c2['members']
        comb_indices = c1['indices'] + c2['indices']
        comb_hh = {'hh_idx': c1['hh_idx'], 'members': comb_mems, 'indices': comb_indices}
        m = len(comb_mems)
        
        candidate_set = set()
        for c in comb_mems:
            g, r, a = c['gender'], c['norm_race'], c['age_num']
            if g and r and not pd.isna(a):
                key = (g, r, int(a // 3))
                if key in ipums_index:
                    candidate_set.update(ipums_index[key])
                    
        best_s = 0.0
        best_i = -1
        for i_idx in candidate_set:
            if i_idx in claimed_i_hhs:
                continue
            i_hh = ipums_hhs[i_idx]
            n = len(i_hh['members'])
            if abs(m - n) > 2:
                continue
            s = score_hh_pair(comb_hh, i_hh)
            if s > best_s:
                best_s = s
                best_i = i_idx
                
        if best_i >= 0 and best_s >= 0.70:
            matched_hh_pairs.append((comb_hh, ipums_hhs[best_i], best_s))
            matched_census_hhs.add(c_idx)
            matched_census_hhs.add(next_idx)
            claimed_i_hhs.add(best_i)
            merged_count += 1
            c_idx += 2
        else:
            c_idx += 1

    print(f"Pass 2 Split-Continuation Merged Households: {merged_count}")
    print(f"Total Confirmed Household Units: {len(matched_hh_pairs)}")

    # Step 3 & 4: Person matching within matched households
    ipums_ids = [''] * census_len
    prop_values = [''] * census_len
    ipums_matches = [''] * census_len

    # Determine census year from birth_year / age
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
    relations = orig_df['relation'].tolist() if 'relation' in orig_df.columns else [''] * census_len

    matched_count = 0
    tie_count = 0
    claimed_ipums_indices = set()

    for c_hh, i_hh, hh_score in matched_hh_pairs:
        c_mems = c_hh['members']
        i_mems = i_hh['members']
        c_indices = c_hh['indices']
        
        m = len(c_mems)
        n = len(i_mems)
        
        # Case A: Institutional block (Asylum / Large GQ) facility pool alignment
        if (i_hh.get('is_inst') or m > 25) and m > 15:
            # Facility pool alignment: match demographically in register order
            claimed_j = set()
            for i in range(m):
                c_rec = c_mems[i]
                c_idx_pos = c_indices[i]
                best_j = -1
                best_score = 0.0
                for j in range(n):
                    if j in claimed_j: continue
                    i_rec = i_mems[j]
                    s = score_person(c_rec, i_rec)
                    if s > best_score:
                        best_score = s
                        best_j = j
                if best_j >= 0 and best_score >= 0.70:
                    claimed_j.add(best_j)
                    i_rec = i_mems[best_j]
                    ipums_ids[c_idx_pos] = str(i_rec.get('ipubs_id', ''))
                    pv = i_rec.get('prop_value', '')
                    if pd.notna(pv) and str(pv) != '':
                        try: prop_values[c_idx_pos] = str(int(float(pv)))
                        except: prop_values[c_idx_pos] = str(pv)
                    else: prop_values[c_idx_pos] = '0'
                    ipums_matches[c_idx_pos] = f'{best_score:.2f}'
                    if update_relation:
                        rel = i_rec.get('norm_relate', '') or i_rec.get('relate', '')
                        relations[c_idx_pos] = str(rel) if pd.notna(rel) else ''
                    matched_count += 1
                    claimed_ipums_indices.add(i_hh['indices'][best_j])
            continue

        # Case B: Standard household 1-to-1 matching with tie protection
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
            
        claimed_i = set()
        matched_pairs = {}
        
        for i in range(m):
            if not c_cand[i]:
                continue
            top_s, top_j = c_cand[i][0]
            
            # Check tie
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
                
            if i_cand[top_j] and i_cand[top_j][0][1] == i and top_j not in claimed_i:
                claimed_i.add(top_j)
                matched_pairs[i] = (top_j, top_s)
                
        for i, (j, s) in matched_pairs.items():
            row_idx = c_indices[i]
            ip_rec = i_mems[j]
            ipums_ids[row_idx] = str(ip_rec.get('ipubs_id', ''))
            
            pv = ip_rec.get('prop_value', '')
            if pd.notna(pv) and str(pv) != '':
                try:
                    prop_values[row_idx] = str(int(float(pv)))
                except:
                    prop_values[row_idx] = str(pv)
            else:
                prop_values[row_idx] = ''
                
            ipums_matches[row_idx] = f'{s:.2f}'
            if update_relation:
                rel = ip_rec.get('norm_relate', '') or ip_rec.get('relate', '')
                relations[row_idx] = str(rel) if pd.notna(rel) else ''
            matched_count += 1
            claimed_ipums_indices.add(i_hh['indices'][j])

    # Step 3b: Institutional Block Sequential Alignment for unmatched large blocks (> 15 members)
    print("Evaluating remaining large institutional candidate blocks...")
    inst_block_matches = 0
    for c_idx, c_hh in enumerate(census_hhs):
        if c_idx in matched_census_hhs:
            continue
        c_mems = c_hh['members']
        m = len(c_mems)
        if m < 15:
            continue
            
        c_indices = c_hh['indices']
        lead = c_mems[0]
        lead2 = c_mems[1] if m > 1 else None
        
        best_start = -1
        best_pct = 0.0
        
        for i in range(len(ipums) - m):
            p1 = ipums.iloc[i]
            if p1['gender'] == lead['gender'] and p1['norm_race'] == lead['norm_race'] and abs(p1['age_num'] - lead['age_num']) <= 1.5:
                if lead2:
                    p2 = ipums.iloc[i+1]
                    if p2['gender'] != lead2['gender'] or p2['norm_race'] != lead2['norm_race'] or abs(p2['age_num'] - lead2['age_num']) > 2.0:
                        continue
                
                m_cnt = 0
                for k in range(m):
                    c_k = c_mems[k]
                    p_k = ipums.iloc[i+k]
                    if score_person(c_k, p_k) >= 0.70:
                        m_cnt += 1
                pct = m_cnt / m
                if pct > best_pct:
                    best_pct = pct
                    best_start = i
                    
        if best_start >= 0 and best_pct >= 0.75:
            inst_block_matches += 1
            matched_census_hhs.add(c_idx)
            for k in range(m):
                row_idx = c_indices[k]
                ip_rec = ipums.iloc[best_start + k]
                s = score_person(c_mems[k], ip_rec)
                if s >= 0.65:
                    ipums_ids[row_idx] = str(ip_rec.get('ipubs_id', ''))
                    pv = ip_rec.get('prop_value', '')
                    if pd.notna(pv) and str(pv) != '':
                        try: prop_values[row_idx] = str(int(float(pv)))
                        except: prop_values[row_idx] = str(pv)
                    else: prop_values[row_idx] = ''
                    ipums_matches[row_idx] = f'{s:.2f}'
                    if update_relation:
                        rel = ip_rec.get('norm_relate', '') or ip_rec.get('relate', '')
                        relations[row_idx] = str(rel) if pd.notna(rel) else ''
                    matched_count += 1
                    claimed_ipums_indices.add(best_start + k)

    print(f"\n==========================================")
    print(f"Matching Completed (Census Year: {census_year}):")
    print(f"Total Census Records: {census_len}")
    print(f"Matched Persons:     {matched_count} ({matched_count/census_len:.2%})")
    print(f"Ambiguous Ties:      {tie_count} ({tie_count/census_len:.2%})")
    print(f"Unmatched:           {census_len - matched_count - tie_count} ({(census_len - matched_count - tie_count)/census_len:.2%})")
    print(f"Institutional Blocks Aligned: {inst_block_matches}")
    if update_relation:
        print(f"Relation column:     Updated from IPUMS ({census_year} file)")
    else:
        print(f"Relation column:     Preserved existing transcription ({census_year} file)")
    print(f"==========================================")

    orig_df['ipums_id'] = ipums_ids
    orig_df['prop_value'] = prop_values
    if update_relation or 'relation' in orig_df.columns:
        orig_df['relation'] = relations
    orig_df['ipums_match'] = ipums_matches

    saved = False
    for attempt in range(5):
        try:
            orig_df.to_csv(output_path, index=False)
            print(f"Saved updated file to: {output_path}")
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
