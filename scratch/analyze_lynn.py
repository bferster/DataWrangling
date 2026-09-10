import os
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

# Filter out the '-' row for numeric analysis
valid = merged[merged['p_lynn'].notna()].copy()

print("=" * 80)
print("LYNN'S HAND MATCHES EVALUATION (N=100 valid pairs)")
print("=" * 80)

print("\n1. OVERALL PAIR CLASSIFICATION")
total_n = len(valid)
for status in ['MATCH', 'MAYBE', 'UN-MATCHED']:
    sub = valid[valid['reviewer_status'] == status]
    n_sub = len(sub)
    d_k = sub['p_d'].notna().sum()
    r_k = sub['p_r'].notna().sum()
    rf_k = sub['p_rf'].notna().sum()
    ip_k = (sub['in_ipums'] == 1).sum()
    print(f"Status {status:<10} (N={n_sub:>2}, {n_sub/total_n:>5.1%}):")
    print(f"  Method D  accepted: {d_k:>2} ({d_k/n_sub:>6.1%}) | Mean p={sub['p_d'].dropna().mean():.4f}, Median={sub['p_d'].dropna().median():.4f}")
    print(f"  Method R  accepted: {r_k:>2} ({r_k/n_sub:>6.1%}) | Mean p={sub['p_r'].dropna().mean():.4f}, Median={sub['p_r'].dropna().median():.4f}")
    print(f"  Method RF accepted: {rf_k:>2} ({rf_k/n_sub:>6.1%}) | Mean p1={sub['p_rf'].dropna().mean():.4f}, Median={sub['p_rf'].dropna().median():.4f}")
    print(f"  IPUMS     accepted: {ip_k:>2} ({ip_k/n_sub:>6.1%})")

print("\n2. PERFORMANCE USING LYNN'S MATCHES AS GOLD STANDARD")
# If Lynn MATCH = True link, UN-MATCHED = False link
# We can evaluate Precision, Recall, and False Discovery Rate on the binary subset (MATCH vs UN-MATCHED, N=85)
binary_sub = valid[valid['reviewer_status'].isin(['MATCH', 'UN-MATCHED'])].copy()
n_match = (binary_sub['reviewer_status'] == 'MATCH').sum() # 41
n_unmatched = (binary_sub['reviewer_status'] == 'UN-MATCHED').sum() # 44

for name, col in [('Method D', 'p_d'), ('Method R', 'p_r'), ('Method RF', 'p_rf'), ('IPUMS', 'in_ipums')]:
    if col == 'in_ipums':
        kept = binary_sub[binary_sub[col] == 1]
    else:
        kept = binary_sub[binary_sub[col].notna()]
    tp = (kept['reviewer_status'] == 'MATCH').sum()
    fp = (kept['reviewer_status'] == 'UN-MATCHED').sum()
    fn = n_match - tp
    prec = tp / (tp + fp) if (tp + fp) > 0 else np.nan
    rec = tp / n_match if n_match > 0 else np.nan
    fdr = fp / (tp + fp) if (tp + fp) > 0 else np.nan
    f1 = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else np.nan
    print(f"  {name:<12}: Accepted={len(kept):>2} | True Pos (MATCH)={tp:>2}, False Pos (UN-MATCHED)={fp:>2} | Precision={prec:.2%}, Recall={rec:.2%}, False Discovery Rate={fdr:.2%}, F1={f1:.3f}")

print("\n3. CORRELATION WITH LYNN PROBABILITIES (MATCH=0.8, MAYBE=0.6, UN-MATCHED=0.3)")
for col, name in [('p_d', 'Method D'), ('p_r', 'Method R'), ('p_rf', 'Method RF')]:
    pair_sub = valid[valid[col].notna()]
    sp = stats.spearmanr(pair_sub['p_lynn'], pair_sub[col])
    pe = stats.pearsonr(pair_sub['p_lynn'], pair_sub[col])
    mad = np.mean(np.abs(pair_sub['p_lynn'] - pair_sub[col]))
    print(f"  {name:<12} (N={len(pair_sub):>2}): Spearman rho = {sp.statistic:.4f} (p={sp.pvalue:.4e}), Pearson r = {pe.statistic:.4f} (p={pe.pvalue:.4e}), MAD = {mad:.4f}")

# What about thresholded R vs RF on Lynn pairs?
print("\n4. THRESHOLDED SEPARATION (R vs RF on Lynn pairs)")
for t in [0.5, 0.6, 0.7, 0.8]:
    r_kept = valid[valid['p_r'] >= t]
    rf_kept = valid[valid['p_rf'] >= t]
    r_tp = (r_kept['reviewer_status'] == 'MATCH').sum()
    r_fp = (r_kept['reviewer_status'] == 'UN-MATCHED').sum()
    rf_tp = (rf_kept['reviewer_status'] == 'MATCH').sum()
    rf_fp = (rf_kept['reviewer_status'] == 'UN-MATCHED').sum()
    print(f"  At threshold {t:.1f}: R keeps {len(r_kept):>2} (TP={r_tp:>2}, FP={r_fp:>2}, Prec={r_tp/(r_tp+r_fp):.1%}) | RF keeps {len(rf_kept):>2} (TP={rf_tp:>2}, FP={rf_fp:>2}, Prec={rf_tp/(rf_tp+rf_fp):.1%})")

# Look at the 2 UN-MATCHED pairs in IPUMS!
print("\n5. THE 2 IPUMS LINKS THAT LYNN LABELED UN-MATCHED:")
ip_unmatched = binary_sub[(binary_sub['in_ipums'] == 1) & (binary_sub['reviewer_status'] == 'UN-MATCHED')]
print(ip_unmatched[['source_id', 'target_id', 'p_d', 'p_r', 'p_rf']])
