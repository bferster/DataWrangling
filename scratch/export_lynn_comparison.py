import pandas as pd
import numpy as np
from scipy import stats

lynn = pd.read_csv('lynn.csv')
d = pd.read_csv('daniel.csv').rename(columns={'unique_id_1870':'source_id', 'unique_id_1880':'target_id', 'probability':'p_d'})
r = pd.read_csv('review.csv').dropna(subset=['target_id']).rename(columns={'probability':'p_r', 'probability1':'p_rf'})
c = pd.read_csv('crosswalk.csv').drop_duplicates(subset=['subject_id', 'object_id']).rename(columns={'subject_id':'source_id', 'object_id':'target_id'})
c['in_ipums'] = 1

prob_map = {'MATCH': 0.8, 'MAYBE': 0.6, 'UN-MATCHED': 0.3}
lynn['p_lynn'] = lynn['reviewer_status'].map(prob_map)

merged = lynn.merge(d[['source_id', 'target_id', 'p_d']], on=['source_id', 'target_id'], how='left')
merged = merged.merge(r[['source_id', 'target_id', 'p_r', 'p_rf']], on=['source_id', 'target_id'], how='left')
merged = merged.merge(c[['source_id', 'target_id', 'in_ipums']], on=['source_id', 'target_id'], how='left')
merged['in_ipums'] = merged['in_ipums'].fillna(0).astype(int)

# Attach mention metadata
mentions = pd.read_csv('COMMON/mentions.csv', encoding='utf-8-sig', low_memory=False).set_index('mention_id').to_dict(orient='index')

def get_name(mid):
    rec = mentions.get(mid, {})
    return f"{rec.get('norm_first_name', '')} {rec.get('nysiis_last_name', '')}".strip()

def get_by(mid):
    return mentions.get(mid, {}).get('birth_year', '')

def get_gen(mid):
    return mentions.get(mid, {}).get('gender', '')

def get_race(mid):
    return mentions.get(mid, {}).get('norm_race', '')

merged['name_1870'] = merged['source_id'].apply(get_name)
merged['birth_1870'] = merged['source_id'].apply(get_by)
merged['gender_1870'] = merged['source_id'].apply(get_gen)
merged['race_1870'] = merged['source_id'].apply(get_race)

merged['name_1880'] = merged['target_id'].apply(get_name)
merged['birth_1880'] = merged['target_id'].apply(get_by)
merged['gender_1880'] = merged['target_id'].apply(get_gen)
merged['race_1880'] = merged['target_id'].apply(get_race)

merged.to_csv('lynn_comparison.csv', index=False)
print(f"Saved lynn_comparison.csv with {len(merged)} rows.")
