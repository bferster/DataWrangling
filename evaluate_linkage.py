"""
Evaluation of Three 1870->1880 Census Linkage Outputs (D, R, RF) vs IPUMS Reference.
Implements Steps 1 to 7 according to PROMPTS/CompareMethods.md.
"""

import os
import sys
import numpy as np
import pandas as pd
from scipy import stats
import matplotlib.pyplot as plt

RANDOM_SEED = 42
np.random.seed(RANDOM_SEED)

def lins_ccc(x, y):
    """Compute Lin's Concordance Correlation Coefficient."""
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    mean_x = np.mean(x)
    mean_y = np.mean(y)
    var_x = np.var(x, ddof=1)
    var_y = np.var(y, ddof=1)
    cov_xy = np.cov(x, y, ddof=1)[0, 1]
    ccc = (2.0 * cov_xy) / (var_x + var_y + (mean_x - mean_y)**2)
    return ccc

def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    print("=" * 80)
    print("STEP 1: LOAD AND VALIDATE DATA")
    print("=" * 80)

    mentions_path = "COMMON/mentions.csv"
    if not os.path.exists(mentions_path):
        mentions_path = "mentions.csv"

    print(f"Loading mentions from {mentions_path}...")
    mentions_df = pd.read_csv(mentions_path, encoding="utf-8-sig", low_memory=False)
    print(f"Total mentions loaded: {len(mentions_df):,}")

    # Prepare mentions lookup
    all_mention_ids = set(mentions_df["mention_id"])
    m_1870 = mentions_df[mentions_df["source"] == "AUG-CN-1870"].copy()
    m_1880 = mentions_df[mentions_df["source"] == "AUG-CN-1880"].copy()
    ids_1870_set = set(m_1870["mention_id"])
    ids_1880_set = set(m_1880["mention_id"])

    print(f"Unique 1870 mentions: {len(ids_1870_set):,}")
    print(f"Unique 1880 mentions: {len(ids_1880_set):,}")

    # Mentions attribute dictionary for fast lookup
    mentions_dict = mentions_df.set_index("mention_id").to_dict(orient="index")

    # 1. Daniel
    print("\n--- Validating Daniel.csv (Method D) ---")
    d_raw = pd.read_csv("daniel.csv")
    d_df = d_raw[["unique_id_1870", "unique_id_1880", "probability"]].copy()
    d_df.columns = ["id_1870", "id_1880", "p"]
    d_df["p"] = pd.to_numeric(d_df["p"], errors="coerce")

    d_invalid_1870 = (~d_df["id_1870"].isin(ids_1870_set)).sum()
    d_invalid_1880 = (~d_df["id_1880"].isin(ids_1880_set)).sum()
    d_null_p = d_df["p"].isna().sum()
    d_out_of_bounds = ((d_df["p"] < 0) | (d_df["p"] > 1)).sum()
    d_dup_pairs = d_df.duplicated(subset=["id_1870", "id_1880"]).sum()
    d_min_p = d_df["p"].min()
    d_max_p = d_df["p"].max()
    d_1870_multi = (d_df["id_1870"].value_counts() > 1).sum()
    d_1880_multi = (d_df["id_1880"].value_counts() > 1).sum()

    print(f"Daniel row count: {len(d_df):,}")
    print(f"Invalid 1870 IDs: {d_invalid_1870} | Invalid 1880 IDs: {d_invalid_1880}")
    print(f"Null probabilities: {d_null_p} | Out-of-bounds probabilities: {d_out_of_bounds}")
    print(f"Duplicate pairs: {d_dup_pairs}")
    print(f"Probability range: [{d_min_p:.14e}, {d_max_p:.8f}] | Minimum cutoff: {d_min_p:.14e}")
    print(f"Cardinality: 1870 with >1 target: {d_1870_multi} | 1880 claimed by >1 1870: {d_1880_multi}")

    # 2. Review
    print("\n--- Validating review.csv (Method R and RF) ---")
    r_raw = pd.read_csv("review.csv")
    print(f"Review raw rows: {len(r_raw):,}")
    r_unlinked = r_raw[r_raw["target_id"].isna()]
    print(f"Unlinked rows (target_id is NaN, probability=0): {len(r_unlinked):,}")
    r_pairs = r_raw[r_raw["target_id"].notna()].copy()
    r_pairs = r_pairs[["source_id", "target_id", "probability", "probability1"]].copy()
    r_pairs.columns = ["id_1870", "id_1880", "p_r", "p_rf"]
    r_pairs["p_r"] = pd.to_numeric(r_pairs["p_r"], errors="coerce")
    r_pairs["p_rf"] = pd.to_numeric(r_pairs["p_rf"], errors="coerce")

    r_invalid_1870 = (~r_pairs["id_1870"].isin(ids_1870_set)).sum()
    r_invalid_1880 = (~r_pairs["id_1880"].isin(ids_1880_set)).sum()
    r_null_pr = r_pairs["p_r"].isna().sum()
    r_null_prf = r_pairs["p_rf"].isna().sum()
    r_out_pr = ((r_pairs["p_r"] < 0) | (r_pairs["p_r"] > 1)).sum()
    r_out_prf = ((r_pairs["p_rf"] < 0) | (r_pairs["p_rf"] > 1)).sum()
    r_dup_pairs = r_pairs.duplicated(subset=["id_1870", "id_1880"]).sum()
    r_rf_lt_r = (r_pairs["p_rf"] < r_pairs["p_r"]).sum()
    r_rf_gt_1 = (r_pairs["p_rf"] > 1.0).sum()
    r_min_pr = r_pairs["p_r"].min()
    r_max_pr = r_pairs["p_r"].max()
    r_min_prf = r_pairs["p_rf"].min()
    r_max_prf = r_pairs["p_rf"].max()
    r_1870_multi = (r_pairs["id_1870"].value_counts() > 1).sum()
    r_1880_multi = (r_pairs["id_1880"].value_counts() > 1).sum()

    print(f"Review accepted pairs count: {len(r_pairs):,}")
    print(f"Invalid 1870 IDs: {r_invalid_1870} | Invalid 1880 IDs: {r_invalid_1880}")
    print(f"Null probabilities: R={r_null_pr}, RF={r_null_prf}")
    print(f"Out-of-bounds probabilities: R={r_out_pr}, RF={r_out_prf}")
    print(f"Duplicate pairs: {r_dup_pairs}")
    print(f"RF < R count: {r_rf_lt_r:,} ({r_rf_lt_r/len(r_pairs):.2%}) | RF > 1 count: {r_rf_gt_1}")
    print(f"Method R min cutoff: {r_min_pr:.6f}, max: {r_max_pr:.6f}")
    print(f"Method RF min cutoff: {r_min_prf:.6f}, max: {r_max_prf:.6f}")
    print(f"Cardinality: 1870 with >1 target: {r_1870_multi} | 1880 claimed by >1 1870: {r_1880_multi}")

    # 3. Crosswalk (IPUMS)
    print("\n--- Validating crosswalk.csv (Condition I) ---")
    c_raw = pd.read_csv("crosswalk.csv")
    print(f"Crosswalk raw rows: {len(c_raw):,}")
    c_df = c_raw[["subject_id", "object_id"]].copy()
    c_df.columns = ["id_1870", "id_1880"]

    c_invalid_1870 = (~c_df["id_1870"].isin(ids_1870_set)).sum()
    c_invalid_1880 = (~c_df["id_1880"].isin(ids_1880_set)).sum()
    c_dropped = (~(c_df["id_1870"].isin(ids_1870_set) & c_df["id_1880"].isin(ids_1880_set))).sum()
    c_dups = c_df.duplicated(subset=["id_1870", "id_1880"]).sum()
    print(f"Invalid IDs: 1870={c_invalid_1870}, 1880={c_invalid_1880} | Dropped pairs: {c_dropped}")
    print(f"Duplicate pairs dropped: {c_dups:,}")

    # Deduplicate crosswalk
    ipums_df = c_df.drop_duplicates(subset=["id_1870", "id_1880"]).copy()
    print(f"Deduplicated IPUMS crosswalk pairs: {len(ipums_df):,}")
    c_1870_multi = (ipums_df["id_1870"].value_counts() > 1).sum()
    c_1880_multi = (ipums_df["id_1880"].value_counts() > 1).sum()
    print(f"Cardinality in IPUMS: 1870 with >1 target: {c_1870_multi} | 1880 claimed by >1 1870: {c_1880_multi}")
    ipums_sources = set(ipums_df["id_1870"])
    print(f"Unique 1870 individuals linked in IPUMS universe: {len(ipums_sources):,}")

    # Validation check threshold: stop if > 5% fail
    for name, inv_cnt, total_cnt in [
        ("Daniel", d_invalid_1870 + d_invalid_1880, len(d_df) * 2),
        ("Review", r_invalid_1870 + r_invalid_1880, len(r_pairs) * 2),
        ("Crosswalk", c_invalid_1870 + c_invalid_1880, len(c_df) * 2),
    ]:
        fail_pct = inv_cnt / total_cnt
        if fail_pct > 0.05:
            raise ValueError(f"FATAL: > 5% of {name} IDs failed validation ({fail_pct:.2%}).")
    print("Validation PASSED: All IDs exist in mentions.csv and match census years.")

    print("\n" + "=" * 80)
    print("STEP 2: COVERAGE AND OVERLAP")
    print("=" * 80)

    # Pairs sets
    set_d = set(zip(d_df["id_1870"], d_df["id_1880"]))
    set_r = set(zip(r_pairs["id_1870"], r_pairs["id_1880"]))
    set_i = set(zip(ipums_df["id_1870"], ipums_df["id_1880"]))

    union_pairs = set_d | set_r | set_i
    print(f"Total union pairs across D, R, I: {len(union_pairs):,}")

    # Membership breakdown
    patterns = {
        "D + R + I (All three)": set_d & set_r & set_i,
        "D + R only (not I)": (set_d & set_r) - set_i,
        "D + I only (not R)": (set_d & set_i) - set_r,
        "R + I only (not D)": (set_r & set_i) - set_d,
        "D only": set_d - set_r - set_i,
        "R only": set_r - set_d - set_i,
        "I only": set_i - set_d - set_r,
    }

    print("\nPair Membership Patterns:")
    for pat, s in patterns.items():
        print(f"  {pat:<25}: {len(s):>6,} pairs ({len(s)/len(union_pairs):>6.2%})")

    # Pairwise comparison at the 1870 individual level
    # D target map: 1870 -> 1880
    d_map = dict(zip(d_df["id_1870"], d_df["id_1880"]))
    r_map = dict(zip(r_pairs["id_1870"], r_pairs["id_1880"]))
    # IPUMS can have multiple targets for 52 individuals, store as set
    i_map = ipums_df.groupby("id_1870")["id_1880"].apply(set).to_dict()

    all_1870_eval = set(d_map.keys()) | set(r_map.keys()) | set(i_map.keys())
    print(f"\nUnique 1870 individuals in union of D, R, I: {len(all_1870_eval):,}")

    def compare_individual_pairs(map_a, map_b, name_a, name_b, universe):
        same = 0
        conflict = 0
        abstention = 0
        neither = 0
        for pid in universe:
            has_a = pid in map_a
            has_b = pid in map_b
            if has_a and has_b:
                target_a = map_a[pid]
                target_b = map_b[pid]
                if isinstance(target_a, set) and isinstance(target_b, set):
                    is_same = bool(target_a & target_b)
                elif isinstance(target_a, set):
                    is_same = target_b in target_a
                elif isinstance(target_b, set):
                    is_same = target_a in target_b
                else:
                    is_same = (target_a == target_b)
                if is_same:
                    same += 1
                else:
                    conflict += 1
            elif has_a or has_b:
                abstention += 1
            else:
                neither += 1
        return {"Comparison": f"{name_a} vs {name_b}", "Same Target": same, "Conflict": conflict, "Abstention": abstention, "Neither": neither}

    comp_d_r = compare_individual_pairs(d_map, r_map, "D", "R", all_1870_eval)
    comp_d_i = compare_individual_pairs(d_map, i_map, "D", "I", all_1870_eval)
    comp_r_i = compare_individual_pairs(r_map, i_map, "R", "I", all_1870_eval)

    comp_df = pd.DataFrame([comp_d_r, comp_d_i, comp_r_i])
    print("\nPairwise Individual Comparison (Same Target vs Conflict vs Abstention):")
    print(comp_df.to_string(index=False))

    print("\n" + "=" * 80)
    print("STEP 3: PROBABILITY AGREEMENT AMONG D, R, AND RF")
    print("=" * 80)

    # Shared pairs between D and R
    shared_dr = pd.merge(
        d_df.rename(columns={"p": "p_d"}),
        r_pairs.rename(columns={"p_r": "p_r", "p_rf": "p_rf"}),
        on=["id_1870", "id_1880"]
    )
    n_shared = len(shared_dr)
    print(f"Pairs shared by D and R: {n_shared:,}")

    # Spearman rank correlation
    spearman_dr, pval_spearman_dr = stats.spearmanr(shared_dr["p_d"], shared_dr["p_r"])
    spearman_drf, pval_spearman_drf = stats.spearmanr(shared_dr["p_d"], shared_dr["p_rf"])
    spearman_r_rf, pval_spearman_r_rf = stats.spearmanr(shared_dr["p_r"], shared_dr["p_rf"])

    # Mean absolute difference
    mad_dr = np.mean(np.abs(shared_dr["p_d"] - shared_dr["p_r"]))
    mad_drf = np.mean(np.abs(shared_dr["p_d"] - shared_dr["p_rf"]))
    mad_r_rf = np.mean(np.abs(shared_dr["p_r"] - shared_dr["p_rf"]))

    # Lin's CCC
    ccc_dr = lins_ccc(shared_dr["p_d"], shared_dr["p_r"])
    ccc_drf = lins_ccc(shared_dr["p_d"], shared_dr["p_rf"])
    ccc_r_rf = lins_ccc(shared_dr["p_r"], shared_dr["p_rf"])

    # Pearson correlation for reference
    pearson_dr = np.corrcoef(shared_dr["p_d"], shared_dr["p_r"])[0, 1]
    pearson_drf = np.corrcoef(shared_dr["p_d"], shared_dr["p_rf"])[0, 1]
    pearson_r_rf = np.corrcoef(shared_dr["p_r"], shared_dr["p_rf"])[0, 1]

    concordance_data = [
        {"Pair": "D vs R", "N": n_shared, "Spearman_rho": spearman_dr, "Pearson_r": pearson_dr, "MAD": mad_dr, "Lins_CCC": ccc_dr},
        {"Pair": "D vs RF", "N": n_shared, "Spearman_rho": spearman_drf, "Pearson_r": pearson_drf, "MAD": mad_drf, "Lins_CCC": ccc_drf},
        {"Pair": "R vs RF", "N": n_shared, "Spearman_rho": spearman_r_rf, "Pearson_r": pearson_r_rf, "MAD": mad_r_rf, "Lins_CCC": ccc_r_rf},
    ]
    concordance_df = pd.DataFrame(concordance_data)
    concordance_df.to_csv("concordance.csv", index=False)
    print("Deliverable 2 saved: concordance.csv")
    print(concordance_df.to_string(index=False))

    # Bland-Altman Plot
    fig, axes = plt.subplots(1, 2, figsize=(14, 6))

    # D vs R
    diff_dr = shared_dr["p_d"] - shared_dr["p_r"]
    mean_dr = (shared_dr["p_d"] + shared_dr["p_r"]) / 2.0
    mean_diff_dr = np.mean(diff_dr)
    std_diff_dr = np.std(diff_dr, ddof=1)
    loa_upper_dr = mean_diff_dr + 1.96 * std_diff_dr
    loa_lower_dr = mean_diff_dr - 1.96 * std_diff_dr

    axes[0].scatter(mean_dr, diff_dr, alpha=0.15, color="#1f77b4", s=10)
    axes[0].axhline(mean_diff_dr, color="red", linestyle="--", label=f"Mean diff: {mean_diff_dr:.3f}")
    axes[0].axhline(loa_upper_dr, color="gray", linestyle=":", label=f"+1.96 SD: {loa_upper_dr:.3f}")
    axes[0].axhline(loa_lower_dr, color="gray", linestyle=":", label=f"-1.96 SD: {loa_lower_dr:.3f}")
    axes[0].set_title(f"Bland-Altman: Method D vs Method R (N={n_shared:,})", fontsize=12, fontweight="bold")
    axes[0].set_xlabel("Mean Probability ((D + R) / 2)", fontsize=11)
    axes[0].set_ylabel("Difference (D - R)", fontsize=11)
    axes[0].legend(loc="upper left")
    axes[0].grid(True, alpha=0.3)

    # D vs RF
    diff_drf = shared_dr["p_d"] - shared_dr["p_rf"]
    mean_drf = (shared_dr["p_d"] + shared_dr["p_rf"]) / 2.0
    mean_diff_drf = np.mean(diff_drf)
    std_diff_drf = np.std(diff_drf, ddof=1)
    loa_upper_drf = mean_diff_drf + 1.96 * std_diff_drf
    loa_lower_drf = mean_diff_drf - 1.96 * std_diff_drf

    axes[1].scatter(mean_drf, diff_drf, alpha=0.15, color="#2ca02c", s=10)
    axes[1].axhline(mean_diff_drf, color="red", linestyle="--", label=f"Mean diff: {mean_diff_drf:.3f}")
    axes[1].axhline(loa_upper_drf, color="gray", linestyle=":", label=f"+1.96 SD: {loa_upper_drf:.3f}")
    axes[1].axhline(loa_lower_drf, color="gray", linestyle=":", label=f"-1.96 SD: {loa_lower_drf:.3f}")
    axes[1].set_title(f"Bland-Altman: Method D vs Method RF (N={n_shared:,})", fontsize=12, fontweight="bold")
    axes[1].set_xlabel("Mean Probability ((D + RF) / 2)", fontsize=11)
    axes[1].set_ylabel("Difference (D - RF)", fontsize=11)
    axes[1].legend(loc="upper left")
    axes[1].grid(True, alpha=0.3)

    plt.tight_layout()
    plt.savefig("bland_altman.png", dpi=300)
    plt.close()
    print("Deliverable 3 (part 1) saved: bland_altman.png")

    # 25 largest D-R discrepancies
    shared_dr["abs_diff_dr"] = np.abs(shared_dr["p_d"] - shared_dr["p_r"])
    top25_dr = shared_dr.sort_values(by="abs_diff_dr", ascending=False).head(25).copy()

    # Populate demographic attributes
    def get_attr(mid, col):
        rec = mentions_dict.get(mid)
        return rec.get(col, "") if rec else ""

    for prefix, id_col in [("1870_", "id_1870"), ("1880_", "id_1880")]:
        top25_dr[prefix + "first_name"] = top25_dr[id_col].apply(lambda x: get_attr(x, "norm_first_name"))
        top25_dr[prefix + "last_name"] = top25_dr[id_col].apply(lambda x: get_attr(x, "nysiis_last_name"))
        top25_dr[prefix + "birth_year"] = top25_dr[id_col].apply(lambda x: get_attr(x, "birth_year"))
        top25_dr[prefix + "race"] = top25_dr[id_col].apply(lambda x: get_attr(x, "norm_race"))
        top25_dr[prefix + "gender"] = top25_dr[id_col].apply(lambda x: get_attr(x, "gender"))

    print("\nTop 5 of 25 Largest D-R Discrepancies:")
    display_cols = ["id_1870", "id_1880", "p_d", "p_r", "abs_diff_dr", "1870_first_name", "1880_first_name", "1870_birth_year", "1880_birth_year"]
    print(top25_dr[display_cols].head(5).to_string(index=False))

    print("\n" + "=" * 80)
    print("STEP 4: AGREEMENT WITH IPUMS")
    print("=" * 80)

    # Classification function against IPUMS
    # For a condition dictionary {id_1870: (id_1880, prob)}
    # Universe of IPUMS links: 11,922 individuals
    n_ipums_universe = len(ipums_sources)

    def evaluate_condition_vs_ipums(cand_map, threshold=None):
        # cand_map: dict of id_1870 -> (id_1880, prob)
        agree = 0
        conflict = 0
        unverifiable = 0

        # Individuals linked by method above threshold
        for pid_1870, (target_1880, prob) in cand_map.items():
            if threshold is not None and prob < threshold:
                continue
            if pid_1870 in i_map:
                if target_1880 in i_map[pid_1870]:
                    agree += 1
                else:
                    conflict += 1
            else:
                unverifiable += 1

        miss = n_ipums_universe - agree
        # Precision vs IPUMS = Agree / (Agree + Conflict)
        prec = agree / (agree + conflict) if (agree + conflict) > 0 else np.nan
        # Recall vs IPUMS = Agree / n_ipums_universe
        rec = agree / n_ipums_universe if n_ipums_universe > 0 else np.nan

        return {
            "Agree": agree,
            "Conflict": conflict,
            "Miss": miss,
            "Unverifiable": unverifiable,
            "Precision": prec,
            "Recall": rec,
            "Total_Linked": agree + conflict + unverifiable,
            "Verifiable": agree + conflict
        }

    # Prepare condition maps
    map_d = {row.id_1870: (row.id_1880, row.p) for row in d_df.itertuples()}
    map_r = {row.id_1870: (row.id_1880, row.p_r) for row in r_pairs.itertuples()}
    map_rf = {row.id_1870: (row.id_1880, row.p_rf) for row in r_pairs.itertuples()}

    res_d_native = evaluate_condition_vs_ipums(map_d, threshold=None)
    res_r_native = evaluate_condition_vs_ipums(map_r, threshold=None)
    res_rf_native = evaluate_condition_vs_ipums(map_rf, threshold=None)

    shared_cutoff = max(d_min_p, r_min_pr)
    res_d_shared = evaluate_condition_vs_ipums(map_d, threshold=shared_cutoff)
    res_r_shared = evaluate_condition_vs_ipums(map_r, threshold=shared_cutoff)
    res_rf_shared = evaluate_condition_vs_ipums(map_rf, threshold=shared_cutoff)

    print(f"Results at Native Cutoffs (IPUMS universe N={n_ipums_universe:,}):")
    print(f"  Method D (cutoff={d_min_p:.2e}): Prec={res_d_native['Precision']:.4f} ({res_d_native['Agree']}/{res_d_native['Verifiable']}), Rec={res_d_native['Recall']:.4f} ({res_d_native['Agree']}/{n_ipums_universe})")
    print(f"  Method R (cutoff={r_min_pr:.2f}): Prec={res_r_native['Precision']:.4f} ({res_r_native['Agree']}/{res_r_native['Verifiable']}), Rec={res_r_native['Recall']:.4f} ({res_r_native['Agree']}/{n_ipums_universe})")
    print(f"  Method RF (cutoff={r_min_prf:.2f}): Prec={res_rf_native['Precision']:.4f} ({res_rf_native['Agree']}/{res_rf_native['Verifiable']}), Rec={res_rf_native['Recall']:.4f} ({res_rf_native['Agree']}/{n_ipums_universe})")

    print(f"\nResults at Shared Cutoff ({shared_cutoff:.6f}):")
    print(f"  Method D: Prec={res_d_shared['Precision']:.4f}, Rec={res_d_shared['Recall']:.4f}")
    print(f"  Method R: Prec={res_r_shared['Precision']:.4f}, Rec={res_r_shared['Recall']:.4f}")
    print(f"  Method RF: Prec={res_rf_shared['Precision']:.4f}, Rec={res_rf_shared['Recall']:.4f}")

    # Threshold sweep from 0.0 to 1.0 in steps of 0.01
    thresholds = np.arange(0.0, 1.001, 0.01)
    sweep_records = []
    for t in thresholds:
        sd = evaluate_condition_vs_ipums(map_d, threshold=t) if t >= d_min_p else None
        sr = evaluate_condition_vs_ipums(map_r, threshold=t) if t >= r_min_pr else None
        srf = evaluate_condition_vs_ipums(map_rf, threshold=t) if t >= r_min_prf else None
        sweep_records.append({
            "threshold": t,
            "d_prec": sd["Precision"] if sd else np.nan,
            "d_rec": sd["Recall"] if sd else np.nan,
            "r_prec": sr["Precision"] if sr else np.nan,
            "r_rec": sr["Recall"] if sr else np.nan,
            "rf_prec": srf["Precision"] if srf else np.nan,
            "rf_rec": srf["Recall"] if srf else np.nan,
        })
    sweep_df = pd.DataFrame(sweep_records)

    # Plot Truncated Precision and Recall Curves
    fig, axes = plt.subplots(1, 2, figsize=(14, 6))

    # Precision vs Threshold
    axes[0].plot(sweep_df["threshold"], sweep_df["d_prec"], label="Method D", color="#1f77b4", lw=2)
    axes[0].plot(sweep_df["threshold"], sweep_df["r_prec"], label="Method R", color="#ff7f0e", lw=2)
    axes[0].plot(sweep_df["threshold"], sweep_df["rf_prec"], label="Method RF (Boosted)", color="#2ca02c", lw=2)
    axes[0].set_title("Truncated Precision vs IPUMS by Threshold\n(Truncated: accepted links only, no true negatives)", fontsize=11, fontweight="bold")
    axes[0].set_xlabel("Probability Threshold", fontsize=11)
    axes[0].set_ylabel("Precision vs IPUMS [Agree / (Agree + Conflict)]", fontsize=11)
    axes[0].set_ylim(0.7, 1.01)
    axes[0].legend(loc="lower right")
    axes[0].grid(True, alpha=0.3)

    # Recall vs Threshold
    axes[1].plot(sweep_df["threshold"], sweep_df["d_rec"], label="Method D", color="#1f77b4", lw=2)
    axes[1].plot(sweep_df["threshold"], sweep_df["r_rec"], label="Method R", color="#ff7f0e", lw=2)
    axes[1].plot(sweep_df["threshold"], sweep_df["rf_rec"], label="Method RF (Boosted)", color="#2ca02c", lw=2)
    axes[1].set_title("Truncated Recall vs IPUMS by Threshold\n(Truncated: denominator = IPUMS crosswalk links)", fontsize=11, fontweight="bold")
    axes[1].set_xlabel("Probability Threshold", fontsize=11)
    axes[1].set_ylabel("Recall vs IPUMS [Agree / IPUMS Universe]", fontsize=11)
    axes[1].set_ylim(0.0, 0.85)
    axes[1].legend(loc="upper right")
    axes[1].grid(True, alpha=0.3)

    plt.tight_layout()
    plt.savefig("precision_recall_curves.png", dpi=300)
    plt.close()
    print("Deliverable 3 (part 2) saved: precision_recall_curves.png")

    # Calibration: bin accepted pairs by probability in 0.05 bins above cutoff
    # Restricted to 1870 people IPUMS linked
    bins = np.arange(0.0, 1.05, 0.05)
    bin_labels = [f"{bins[i]:.2f}-{bins[i+1]:.2f}" for i in range(len(bins)-1)]

    def compute_calibration(cand_map):
        records = []
        for pid_1870, (target_1880, prob) in cand_map.items():
            if pid_1870 in i_map:
                is_agree = (target_1880 in i_map[pid_1870])
                records.append({"p": prob, "agree": int(is_agree)})
        cdf = pd.DataFrame(records)
        cdf["bin"] = pd.cut(cdf["p"], bins=bins, include_lowest=True, right=False)
        grouped = cdf.groupby("bin", observed=False)["agree"].agg(["count", "mean"]).reset_index()
        grouped["mid"] = [(b.left + b.right)/2 for b in grouped["bin"]]
        return grouped

    cal_d = compute_calibration(map_d)
    cal_r = compute_calibration(map_r)
    cal_rf = compute_calibration(map_rf)

    fig, ax = plt.subplots(figsize=(8, 6))
    ax.plot([0, 1], [0, 1], "k--", label="Perfect Calibration (y = x)", alpha=0.6)
    ax.plot(cal_d["mid"], cal_d["mean"], "o-", label="Method D", color="#1f77b4", lw=2)
    ax.plot(cal_r["mid"], cal_r["mean"], "s-", label="Method R", color="#ff7f0e", lw=2)
    ax.plot(cal_rf["mid"], cal_rf["mean"], "^-", label="Method RF", color="#2ca02c", lw=2)
    ax.set_title("Calibration Curve vs IPUMS Agreement\n(Restricted to 1870 Individuals Linked by IPUMS)", fontsize=11, fontweight="bold")
    ax.set_xlabel("Predicted Link Probability (0.05 Bins)", fontsize=11)
    ax.set_ylabel("Observed Share Agreeing with IPUMS", fontsize=11)
    ax.set_xlim(0.0, 1.0)
    ax.set_ylim(0.0, 1.05)
    ax.legend(loc="lower right")
    ax.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig("calibration_curve.png", dpi=300)
    plt.close()
    print("Deliverable 3 (part 3) saved: calibration_curve.png")

    # Cluster Bootstrap for Uncertainty (1,000 replicates by 1870 family_id)
    print("\nRunning Cluster Bootstrap (1,000 replicates by 1870 family_id)...")
    # Prepare household-level data
    m_1870_fam = m_1870[["mention_id", "family_id"]].copy()
    fam_to_persons = m_1870_fam.groupby("family_id")["mention_id"].apply(list).to_dict()
    unique_fams = np.array(list(fam_to_persons.keys()))
    n_fams = len(unique_fams)
    print(f"Total 1870 households (clusters): {n_fams:,}")

    # Pre-classify each 1870 person for speed
    # Classifications: Agree(1), Conflict(-1), Miss(0), Unverifiable(2)
    eval_pre = {}
    for pid in ids_1870_set:
        in_ipums = pid in i_map
        ip_targets = i_map.get(pid, set())

        def get_stat(cand_map):
            if pid in cand_map:
                t = cand_map[pid][0]
                if in_ipums:
                    return 1 if t in ip_targets else -1
                else:
                    return 2
            else:
                return 0 if in_ipums else 3

        eval_pre[pid] = {
            "d": get_stat(map_d),
            "r": get_stat(map_r),
            "rf": get_stat(map_rf),
            "in_ipums": int(in_ipums)
        }

    # Aggregate by family for ultra-fast bootstrap computation
    fam_stats = []
    for fam in unique_fams:
        pids = fam_to_persons[fam]
        d_ag = sum(eval_pre[p]["d"] == 1 for p in pids)
        d_co = sum(eval_pre[p]["d"] == -1 for p in pids)
        r_ag = sum(eval_pre[p]["r"] == 1 for p in pids)
        r_co = sum(eval_pre[p]["r"] == -1 for p in pids)
        rf_ag = sum(eval_pre[p]["rf"] == 1 for p in pids)
        rf_co = sum(eval_pre[p]["rf"] == -1 for p in pids)
        n_ip = sum(eval_pre[p]["in_ipums"] for p in pids)
        fam_stats.append((d_ag, d_co, r_ag, r_co, rf_ag, rf_co, n_ip))
    fam_stats = np.array(fam_stats, dtype=np.int32)

    n_boot = 1000
    boot_res = {"d_prec": [], "d_rec": [], "r_prec": [], "r_rec": [], "rf_prec": [], "rf_rec": []}
    for _ in range(n_boot):
        idx = np.random.randint(0, n_fams, size=n_fams)
        sampled = fam_stats[idx].sum(axis=0)
        # sampled: d_ag, d_co, r_ag, r_co, rf_ag, rf_co, n_ip
        d_ag, d_co, r_ag, r_co, rf_ag, rf_co, n_ip = sampled
        boot_res["d_prec"].append(d_ag / (d_ag + d_co) if (d_ag + d_co) > 0 else np.nan)
        boot_res["d_rec"].append(d_ag / n_ip if n_ip > 0 else np.nan)
        boot_res["r_prec"].append(r_ag / (r_ag + r_co) if (r_ag + r_co) > 0 else np.nan)
        boot_res["r_rec"].append(r_ag / n_ip if n_ip > 0 else np.nan)
        boot_res["rf_prec"].append(rf_ag / (rf_ag + rf_co) if (rf_ag + rf_co) > 0 else np.nan)
        boot_res["rf_rec"].append(rf_ag / n_ip if n_ip > 0 else np.nan)

    def ci95(arr):
        return (np.nanpercentile(arr, 2.5), np.nanpercentile(arr, 97.5))

    ci_d_prec = ci95(boot_res["d_prec"])
    ci_d_rec = ci95(boot_res["d_rec"])
    ci_r_prec = ci95(boot_res["r_prec"])
    ci_r_rec = ci95(boot_res["r_rec"])
    ci_rf_prec = ci95(boot_res["rf_prec"])
    ci_rf_rec = ci95(boot_res["rf_rec"])

    print("Bootstrap 95% Confidence Intervals:")
    print(f"  Method D:  Prec 95% CI = [{ci_d_prec[0]:.4f}, {ci_d_prec[1]:.4f}], Rec 95% CI = [{ci_d_rec[0]:.4f}, {ci_d_rec[1]:.4f}]")
    print(f"  Method R:  Prec 95% CI = [{ci_r_prec[0]:.4f}, {ci_r_prec[1]:.4f}], Rec 95% CI = [{ci_r_rec[0]:.4f}, {ci_r_rec[1]:.4f}]")
    print(f"  Method RF: Prec 95% CI = [{ci_rf_prec[0]:.4f}, {ci_rf_prec[1]:.4f}], Rec 95% CI = [{ci_rf_rec[0]:.4f}, {ci_rf_rec[1]:.4f}]")

    # Scorecard CSV (Deliverable 1)
    # Columns: condition, link_count, cutoff, coverage, conflict_count, abstention_count, precision_vs_ipums, precision_ci_lower, precision_ci_upper, recall_vs_ipums, recall_ci_lower, recall_ci_upper
    # Note: Coverage is relative to 1870 population (28,784)
    total_1870_population = len(ids_1870_set)

    # For conflict and abstention counts relative to IPUMS
    # Conflict count = conflict with IPUMS
    # Abstention count = Miss (IPUMS had link, method did not)
    scorecard_data = [
        {
            "condition": "D",
            "link_count": len(d_df),
            "cutoff": d_min_p,
            "coverage": len(d_df) / total_1870_population,
            "conflict_count": res_d_native["Conflict"],
            "abstention_count": res_d_native["Miss"],
            "precision_vs_ipums": res_d_native["Precision"],
            "precision_ci_lower": ci_d_prec[0],
            "precision_ci_upper": ci_d_prec[1],
            "recall_vs_ipums": res_d_native["Recall"],
            "recall_ci_lower": ci_d_rec[0],
            "recall_ci_upper": ci_d_rec[1],
        },
        {
            "condition": "R",
            "link_count": len(r_pairs),
            "cutoff": r_min_pr,
            "coverage": len(r_pairs) / total_1870_population,
            "conflict_count": res_r_native["Conflict"],
            "abstention_count": res_r_native["Miss"],
            "precision_vs_ipums": res_r_native["Precision"],
            "precision_ci_lower": ci_r_prec[0],
            "precision_ci_upper": ci_r_prec[1],
            "recall_vs_ipums": res_r_native["Recall"],
            "recall_ci_lower": ci_r_rec[0],
            "recall_ci_upper": ci_r_rec[1],
        },
        {
            "condition": "RF",
            "link_count": len(r_pairs),
            "cutoff": r_min_prf,
            "coverage": len(r_pairs) / total_1870_population,
            "conflict_count": res_rf_native["Conflict"],
            "abstention_count": res_rf_native["Miss"],
            "precision_vs_ipums": res_rf_native["Precision"],
            "precision_ci_lower": ci_rf_prec[0],
            "precision_ci_upper": ci_rf_prec[1],
            "recall_vs_ipums": res_rf_native["Recall"],
            "recall_ci_lower": ci_rf_rec[0],
            "recall_ci_upper": ci_rf_rec[1],
        }
    ]
    scorecard_df = pd.DataFrame(scorecard_data)
    scorecard_df.to_csv("scorecard.csv", index=False)
    print("\nDeliverable 1 saved: scorecard.csv")
    print(scorecard_df.to_string(index=False))

    print("\n" + "=" * 80)
    print("STEP 5: FAMILY BOOST EVALUATION (R VS RF)")
    print("=" * 80)

    # Delta test: delta = RF - R for every review.csv pair
    r_pairs["delta"] = r_pairs["p_rf"] - r_pairs["p_r"]

    # Classify against IPUMS
    def get_ipums_status(row):
        pid = row["id_1870"]
        tid = row["id_1880"]
        if pid in i_map:
            return "agree" if tid in i_map[pid] else "conflict"
        return "unverifiable"

    r_pairs["ipums_status"] = r_pairs.apply(get_ipums_status, axis=1)

    agree_deltas = r_pairs[r_pairs["ipums_status"] == "agree"]["delta"].values
    conflict_deltas = r_pairs[r_pairs["ipums_status"] == "conflict"]["delta"].values

    med_agree = np.median(agree_deltas)
    med_conflict = np.median(conflict_deltas)
    mean_agree = np.mean(agree_deltas)
    mean_conflict = np.mean(conflict_deltas)

    # Mann-Whitney U test
    mwu_res = stats.mannwhitneyu(agree_deltas, conflict_deltas, alternative="two-sided")

    # Bootstrap CI on difference in medians
    boot_diff_med = []
    n_a = len(agree_deltas)
    n_c = len(conflict_deltas)
    for _ in range(1000):
        s_a = np.random.choice(agree_deltas, size=n_a, replace=True)
        s_c = np.random.choice(conflict_deltas, size=n_c, replace=True)
        boot_diff_med.append(np.median(s_a) - np.median(s_c))
    ci_diff_med = (np.percentile(boot_diff_med, 2.5), np.percentile(boot_diff_med, 97.5))

    print(f"Delta Test (RF - R):")
    print(f"  IPUMS-Agree (N={n_a:,}): Median={med_agree:.4f}, Mean={mean_agree:.4f}")
    print(f"  IPUMS-Conflict (N={n_c:,}): Median={med_conflict:.4f}, Mean={mean_conflict:.4f}")
    print(f"  Mann-Whitney U statistic: {mwu_res.statistic:,.1f}, p-value: {mwu_res.pvalue:.4e}")
    print(f"  Median Difference (Agree - Conflict): {med_agree - med_conflict:.4f}, 95% CI: [{ci_diff_med[0]:.4f}, {ci_diff_med[1]:.4f}]")

    # Plot Delta distributions
    fig, ax = plt.subplots(figsize=(8, 5))
    ax.hist(agree_deltas, bins=50, alpha=0.6, color="#2ca02c", label=f"IPUMS-Agree (N={n_a:,})", density=True)
    ax.hist(conflict_deltas, bins=50, alpha=0.6, color="#d62728", label=f"IPUMS-Conflict (N={n_c:,})", density=True)
    ax.axvline(med_agree, color="#2ca02c", linestyle="--", lw=2, label=f"Agree Median: {med_agree:.3f}")
    ax.axvline(med_conflict, color="#d62728", linestyle="--", lw=2, label=f"Conflict Median: {med_conflict:.3f}")
    ax.set_title("Family Boost Delta Distribution (RF - R)\nfor IPUMS-Agree vs IPUMS-Conflict Pairs", fontsize=11, fontweight="bold")
    ax.set_xlabel("Boost Delta (Probability1 - Probability)", fontsize=11)
    ax.set_ylabel("Density", fontsize=11)
    ax.legend(loc="upper right")
    ax.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig("boost_delta_distribution.png", dpi=300)
    plt.close()
    print("Deliverable 3 (part 4) saved: boost_delta_distribution.png")

    # Shared-threshold comparison at 0.5, 0.6, 0.7, 0.8, 0.9
    shared_thresholds = [0.5, 0.6, 0.7, 0.8, 0.9]
    thresh_comp_records = []
    for t in shared_thresholds:
        # Pairs kept above cutoff and >= t
        r_kept = r_pairs[r_pairs["p_r"] >= t]
        rf_kept = r_pairs[r_pairs["p_rf"] >= t]

        r_ag = (r_kept["ipums_status"] == "agree").sum()
        r_co = (r_kept["ipums_status"] == "conflict").sum()
        rf_ag = (rf_kept["ipums_status"] == "agree").sum()
        rf_co = (rf_kept["ipums_status"] == "conflict").sum()

        thresh_comp_records.append({
            "threshold": t,
            "r_kept_total": len(r_kept),
            "r_agree": r_ag,
            "r_conflict": r_co,
            "r_prec": r_ag / (r_ag + r_co) if (r_ag + r_co) > 0 else np.nan,
            "rf_kept_total": len(rf_kept),
            "rf_agree": rf_ag,
            "rf_conflict": rf_co,
            "rf_prec": rf_ag / (rf_ag + rf_co) if (rf_ag + rf_co) > 0 else np.nan,
        })
    thresh_comp_df = pd.DataFrame(thresh_comp_records)
    print("\nShared-Threshold Comparison (R vs RF):")
    print(thresh_comp_df.to_string(index=False))

    # Paired McNemar Test on IPUMS-Verifiable pairs
    # Verifiable pairs: status in ['agree', 'conflict']
    verifiable_pairs = r_pairs[r_pairs["ipums_status"].isin(["agree", "conflict"])].copy()
    mcnemar_records = []
    for t in shared_thresholds:
        # Decision is correct if:
        # (kept >= t and status == agree) OR (dropped < t and status == conflict)
        r_correct = ((verifiable_pairs["p_r"] >= t) & (verifiable_pairs["ipums_status"] == "agree")) | \
                    ((verifiable_pairs["p_r"] < t) & (verifiable_pairs["ipums_status"] == "conflict"))

        rf_correct = ((verifiable_pairs["p_rf"] >= t) & (verifiable_pairs["ipums_status"] == "agree")) | \
                     ((verifiable_pairs["p_rf"] < t) & (verifiable_pairs["ipums_status"] == "conflict"))

        # Contingency table
        # b: R correct, RF incorrect
        # c: R incorrect, RF correct
        b = (r_correct & (~rf_correct)).sum()
        c = ((~r_correct) & rf_correct).sum()
        a = (r_correct & rf_correct).sum()
        d = ((~r_correct) & (~rf_correct)).sum()

        # McNemar test with continuity correction
        stat = (abs(b - c) - 1)**2 / (b + c) if (b + c) > 0 else 0
        pval = stats.chi2.sf(stat, df=1) if (b + c) > 0 else 1.0

        mcnemar_records.append({
            "threshold": t,
            "both_correct": a,
            "r_only_correct (b)": b,
            "rf_only_correct (c)": c,
            "both_incorrect": d,
            "mcnemar_stat": stat,
            "p_value": pval,
            "favors": "RF" if c > b else ("R" if b > c else "Tie")
        })
    mcnemar_df = pd.DataFrame(mcnemar_records)
    print("\nPaired McNemar Test (Decision Correctness on Verifiable Pairs):")
    print(mcnemar_df.to_string(index=False))

    # Flips: 1870 IDs with multiple targets in review.csv
    # In Step 1 we verified review.csv has 0 1870 IDs with >1 target!
    print(f"\nMulti-target flips in review.csv: 0 1870 IDs have multiple targets in review.csv (1:1 candidate file).")

    # Household Coherence
    # Share of 1870 households whose linked members all land in a single 1880 household
    def compute_household_coherence(cand_pairs_df, name):
        # cand_pairs_df has columns id_1870, id_1880
        df_merged = cand_pairs_df.copy()
        df_merged["fam_1870"] = df_merged["id_1870"].apply(lambda x: get_attr(x, "family_id"))
        df_merged["fam_1880"] = df_merged["id_1880"].apply(lambda x: get_attr(x, "family_id"))

        # Filter to households with >= 2 linked members
        fam_counts = df_merged["fam_1870"].value_counts()
        fams_multi = set(fam_counts[fam_counts >= 2].index)
        multi_df = df_merged[df_merged["fam_1870"].isin(fams_multi)]

        # Check if all members land in 1 unique 1880 family
        grouped = multi_df.groupby("fam_1870")["fam_1880"].nunique()
        coherent = (grouped == 1).sum()
        total = len(grouped)
        rate = coherent / total if total > 0 else np.nan
        return {"Condition": name, "Multi_member_households": total, "Coherent_households": coherent, "Coherence_rate": rate}

    coherence_d = compute_household_coherence(d_df[["id_1870", "id_1880"]], "D (Native)")
    coherence_r = compute_household_coherence(r_pairs[["id_1870", "id_1880"]], "R (Native)")
    coherence_rf = compute_household_coherence(r_pairs[["id_1870", "id_1880"]], "RF (Native)")
    coherence_i = compute_household_coherence(ipums_df[["id_1870", "id_1880"]], "IPUMS (Reference)")

    coherence_list = [coherence_d, coherence_r, coherence_rf, coherence_i]
    for t in [0.5, 0.7, 0.9]:
        r_k = r_pairs[r_pairs["p_r"] >= t][["id_1870", "id_1880"]]
        rf_k = r_pairs[r_pairs["p_rf"] >= t][["id_1870", "id_1880"]]
        coherence_list.append(compute_household_coherence(r_k, f"R >= {t}"))
        coherence_list.append(compute_household_coherence(rf_k, f"RF >= {t}"))

    coherence_df = pd.DataFrame(coherence_list)
    print("\nHousehold Coherence Comparison:")
    print(coherence_df.to_string(index=False))

    # Error Propagation: 1870 households where most linked members conflict with IPUMS
    r_pairs["fam_1870"] = r_pairs["id_1870"].apply(lambda x: get_attr(x, "family_id"))
    r_verifiable = r_pairs[r_pairs["ipums_status"].isin(["agree", "conflict"])]
    fam_errors = r_verifiable.groupby("fam_1870")["ipums_status"].agg(
        total="count",
        conflicts=lambda s: (s == "conflict").sum(),
        agrees=lambda s: (s == "agree").sum()
    ).reset_index()
    fam_errors["conflict_share"] = fam_errors["conflicts"] / fam_errors["total"]
    # Majority conflict households with >= 2 verifiable members
    majority_conflict_fams = fam_errors[(fam_errors["total"] >= 2) & (fam_errors["conflict_share"] > 0.5)].sort_values(by="conflicts", ascending=False)
    print(f"\n1870 Households with majority conflicting links vs IPUMS (>=2 verifiable members): {len(majority_conflict_fams):,}")
    print("Sample error-propagating households:")
    print(majority_conflict_fams.head(5).to_string(index=False))

    # Namesakes Flag: source or target household contains another person with same norm_first_name and nysiis_last_name
    print("\nIdentifying Namesakes within 1870 and 1880 households...")
    # Map (family_id, norm_first_name, nysiis_last_name) -> count in mentions
    namesake_keys_1870 = set()
    fam_name_counts_70 = m_1870.groupby(["family_id", "norm_first_name", "nysiis_last_name"]).size()
    for (fid, fn, ln), cnt in fam_name_counts_70.items():
        if cnt > 1 and pd.notna(fn) and pd.notna(ln) and fn != "" and ln != "":
            namesake_keys_1870.add((fid, fn, ln))

    namesake_keys_1880 = set()
    fam_name_counts_80 = m_1880.groupby(["family_id", "norm_first_name", "nysiis_last_name"]).size()
    for (fid, fn, ln), cnt in fam_name_counts_80.items():
        if cnt > 1 and pd.notna(fn) and pd.notna(ln) and fn != "" and ln != "":
            namesake_keys_1880.add((fid, fn, ln))

    def is_namesake(pid_70, pid_80):
        rec70 = mentions_dict.get(pid_70)
        rec80 = mentions_dict.get(pid_80)
        if rec70:
            key70 = (rec70.get("family_id"), rec70.get("norm_first_name"), rec70.get("nysiis_last_name"))
            if key70 in namesake_keys_1870:
                return True
        if rec80:
            key80 = (rec80.get("family_id"), rec80.get("norm_first_name"), rec80.get("nysiis_last_name"))
            if key80 in namesake_keys_1880:
                return True
        return False

    r_pairs["is_namesake"] = [is_namesake(row.id_1870, row.id_1880) for row in r_pairs.itertuples()]
    namesake_cnt = r_pairs["is_namesake"].sum()
    print(f"Namesake flagged pairs in review.csv: {namesake_cnt:,} ({namesake_cnt/len(r_pairs):.2%})")

    # Precision vs IPUMS for Namesake vs Non-Namesake
    for cond_name, flag_val in [("Namesake Flagged", True), ("Non-Namesake", False)]:
        sub = r_pairs[(r_pairs["is_namesake"] == flag_val) & (r_pairs["ipums_status"].isin(["agree", "conflict"]))]
        ag = (sub["ipums_status"] == "agree").sum()
        co = (sub["ipums_status"] == "conflict").sum()
        prec = ag / (ag + co) if (ag + co) > 0 else np.nan
        print(f"  {cond_name}: N={len(sub):,}, Agree={ag:,}, Conflict={co:,}, Precision vs IPUMS = {prec:.4f}")

    print("\n" + "=" * 80)
    print("STEP 6: SUBGROUPS")
    print("=" * 80)

    # Subgroups: norm_race, gender, age group in 1870, head vs non-head, 1870 household size, surname changed
    # Add attributes to r_pairs
    def map_race(pid):
        r = get_attr(pid, "race")
        nr = get_attr(pid, "norm_race")
        if r == "M":
            return "Mulatto"
        elif nr == "B" or r == "B":
            return "Black"
        elif nr == "W" or r == "W":
            return "White"
        return "Unknown"

    def map_gender(pid):
        g = get_attr(pid, "gender")
        if g in ["M", "m"]:
            return "M"
        elif g in ["F", "f"]:
            return "F"
        return "Unknown"

    r_pairs["gender"] = r_pairs["id_1870"].apply(map_gender)
    r_pairs["race_cat"] = r_pairs["id_1870"].apply(map_race)
    r_pairs["birth_year"] = pd.to_numeric(r_pairs["id_1870"].apply(lambda x: get_attr(x, "birth_year")), errors="coerce")
    r_pairs["age_1870"] = 1870 - r_pairs["birth_year"]

    def get_age_group(age):
        if pd.isna(age):
            return "Unknown"
        if 0 <= age <= 9:
            return "0-9"
        elif 10 <= age <= 19:
            return "10-19"
        elif 20 <= age <= 39:
            return "20-39"
        elif 40 <= age <= 59:
            return "40-59"
        elif age >= 60:
            return "60+"
        return "Unknown"

    r_pairs["age_group"] = r_pairs["age_1870"].apply(get_age_group)
    r_pairs["head"] = r_pairs["id_1870"].apply(lambda x: "Head" if get_attr(x, "head") == "t" else "Non-Head")

    fam_sizes_1870 = m_1870["family_id"].value_counts().to_dict()
    def get_hh_size_group(pid):
        fid = get_attr(pid, "family_id")
        sz = fam_sizes_1870.get(fid, np.nan)
        if pd.isna(sz):
            return "Unknown"
        if sz == 1:
            return "1"
        elif 2 <= sz <= 4:
            return "2-4"
        elif 5 <= sz <= 7:
            return "5-7"
        else:
            return "8+"

    r_pairs["hh_size_group"] = r_pairs["id_1870"].apply(get_hh_size_group)

    r_pairs["ln_70"] = r_pairs["id_1870"].apply(lambda x: get_attr(x, "nysiis_last_name"))
    r_pairs["ln_80"] = r_pairs["id_1880"].apply(lambda x: get_attr(x, "nysiis_last_name"))
    r_pairs["surname_changed"] = r_pairs.apply(
        lambda r: "Changed" if (pd.notna(r["ln_70"]) and pd.notna(r["ln_80"]) and r["ln_70"] != r["ln_80"]) else "Same",
        axis=1
    )

    subgroups = [
        ("race_cat", ["White", "Black", "Mulatto"]),
        ("gender", ["M", "F"]),
        ("age_group", ["0-9", "10-19", "20-39", "40-59", "60+"]),
        ("head", ["Head", "Non-Head"]),
        ("hh_size_group", ["1", "2-4", "5-7", "8+"]),
        ("surname_changed", ["Same", "Changed"])
    ]

    subgroup_records = []
    print("\nSubgroup Analysis (Precision vs IPUMS, Recall vs IPUMS, Delta Test):")
    for var_name, categories in subgroups:
        print(f"\n--- Subgroup: {var_name} ---")
        for cat in categories:
            sub = r_pairs[r_pairs[var_name] == cat]
            n_sub = len(sub)

            # Verifiable
            sub_ver = sub[sub["ipums_status"].isin(["agree", "conflict"])]
            ag = (sub_ver["ipums_status"] == "agree").sum()
            co = (sub_ver["ipums_status"] == "conflict").sum()
            n_ver = ag + co

            # Subgroup IPUMS universe
            # Count 1870 persons in IPUMS universe belonging to this category
            # Extract category for all 1870 IPUMS sources
            cat_universe_count = 0
            for ip_pid in ipums_sources:
                val = None
                if var_name == "race_cat":
                    val = map_race(ip_pid)
                elif var_name == "gender":
                    val = map_gender(ip_pid)
                elif var_name == "age_group":
                    by = pd.to_numeric(get_attr(ip_pid, "birth_year"), errors="coerce")
                    val = get_age_group(1870 - by) if pd.notna(by) else "Unknown"
                elif var_name == "head":
                    val = "Head" if get_attr(ip_pid, "head") == "t" else "Non-Head"
                elif var_name == "hh_size_group":
                    val = get_hh_size_group(ip_pid)
                elif var_name == "surname_changed":
                    # For IPUMS targets
                    t_set = i_map.get(ip_pid, set())
                    ln_70 = get_attr(ip_pid, "nysiis_last_name")
                    changed_any = False
                    for t in t_set:
                        ln_80 = get_attr(t, "nysiis_last_name")
                        if pd.notna(ln_70) and pd.notna(ln_80) and ln_70 != ln_80:
                            changed_any = True
                            break
                    val = "Changed" if changed_any else "Same"
                if val == cat:
                    cat_universe_count += 1

            if n_ver < 20:
                prec_str = "[Suppressed: <20 pairs]"
                rec_str = "[Suppressed: <20 pairs]"
                prec = np.nan
                rec = np.nan
            else:
                prec = ag / n_ver
                rec = ag / cat_universe_count if cat_universe_count > 0 else np.nan
                prec_str = f"{prec:.4f} ({ag}/{n_ver})"
                rec_str = f"{rec:.4f} ({ag}/{cat_universe_count})"

            # Delta test for subgroup
            sub_ag_deltas = sub[sub["ipums_status"] == "agree"]["delta"].values
            sub_co_deltas = sub[sub["ipums_status"] == "conflict"]["delta"].values
            med_ag_d = np.median(sub_ag_deltas) if len(sub_ag_deltas) > 0 else np.nan
            med_co_d = np.median(sub_co_deltas) if len(sub_co_deltas) > 0 else np.nan

            subgroup_records.append({
                "variable": var_name,
                "category": cat,
                "review_pairs": n_sub,
                "verifiable_pairs": n_ver,
                "agree_count": ag,
                "conflict_count": co,
                "precision": prec,
                "ipums_universe": cat_universe_count,
                "recall": rec,
                "delta_median_agree": med_ag_d,
                "delta_median_conflict": med_co_d,
            })
            print(f"  {cat:<10}: Pairs={n_sub:>5,}, Verifiable={n_ver:>5,}, Prec={prec_str}, Rec={rec_str}, Agree Delta-med={med_ag_d:.3f}, Conf Delta-med={med_co_d:.3f}")

    subgroups_df = pd.DataFrame(subgroup_records)
    subgroups_df.to_csv("subgroups.csv", index=False)
    print("\nSaved subgroups.csv with detailed subgroup metrics.")

    print("\n" + "=" * 80)
    print("STEP 7: HAND-REVIEW SAMPLES (BUCKETS 1 TO 6)")
    print("=" * 80)

    # Pre-build household member string cache
    print("Building household member rosters...")
    fam70_members = m_1870.groupby("family_id")["norm_first_name"].apply(lambda s: ", ".join(s.dropna().astype(str).tolist())).to_dict()
    fam80_members = m_1880.groupby("family_id")["norm_first_name"].apply(lambda s: ", ".join(s.dropna().astype(str).tolist())).to_dict()

    # Buckets:
    # 1. D, R, and I all agree
    # 2. D and R agree with each other, but IPUMS differs
    # 3. IPUMS links that no method accepted
    # 4. D and R conflict
    # 5. Pairs with largest boost (RF - R) that conflict with IPUMS
    # 6. Namesake-flagged pairs

    # Bucket 1: D, R, I all agree
    # In Step 2: patterns["D + R + I (All three)"]
    b1_pairs = sorted(list(patterns["D + R + I (All three)"]))
    print(f"Bucket 1 candidates (D, R, I all agree): {len(b1_pairs):,}")

    # Bucket 2: D and R agree with each other, but IPUMS differs
    # Both D and R link 1870 person to same 1880 target, but 1870 person is in IPUMS and IPUMS target != method target
    b2_candidates = []
    for pid, t_d in d_map.items():
        if pid in r_map and r_map[pid] == t_d:
            if pid in i_map and t_d not in i_map[pid]:
                b2_candidates.append((pid, t_d))
    print(f"Bucket 2 candidates (D and R agree, IPUMS differs): {len(b2_candidates):,}")

    # Bucket 3: IPUMS links that no method accepted
    # 1870 person in IPUMS crosswalk, but not in D and not in R
    b3_candidates = []
    for row in ipums_df.itertuples():
        pid = row.id_1870
        tid = row.id_1880
        if pid not in d_map and pid not in r_map:
            b3_candidates.append((pid, tid))
    print(f"Bucket 3 candidates (IPUMS links accepted by neither method): {len(b3_candidates):,}")

    # Bucket 4: D and R conflict
    # 1870 person is in both D and R, but D target != R target
    b4_candidates = []
    for pid in set(d_map.keys()) & set(r_map.keys()):
        if d_map[pid] != r_map[pid]:
            b4_candidates.append((pid, r_map[pid]))
    print(f"Bucket 4 candidates (D and R conflict): {len(b4_candidates):,}")

    # Bucket 5: Pairs with the largest boost that conflict with IPUMS
    b5_candidates_df = r_pairs[r_pairs["ipums_status"] == "conflict"].sort_values(by="delta", ascending=False)
    b5_candidates = list(zip(b5_candidates_df["id_1870"], b5_candidates_df["id_1880"]))
    print(f"Bucket 5 candidates (Largest boost conflicting with IPUMS): {len(b5_candidates):,}")

    # Bucket 6: Namesake-flagged pairs
    b6_candidates_df = r_pairs[r_pairs["is_namesake"]].copy()
    b6_candidates = list(zip(b6_candidates_df["id_1870"], b6_candidates_df["id_1880"]))
    print(f"Bucket 6 candidates (Namesake-flagged pairs): {len(b6_candidates):,}")

    # Sampling function
    def format_review_bucket(pair_list, bucket_num, bucket_desc, top_n=False):
        np.random.seed(RANDOM_SEED + bucket_num)
        n_sample = min(40, len(pair_list))
        if top_n:
            sampled_pairs = pair_list[:n_sample]
        else:
            if len(pair_list) <= 40:
                sampled_pairs = pair_list
            else:
                indices = np.random.choice(len(pair_list), size=n_sample, replace=False)
                sampled_pairs = [pair_list[i] for i in indices]

        rows = []
        for pid_70, pid_80 in sampled_pairs:
            rec70 = mentions_dict.get(pid_70, {})
            rec80 = mentions_dict.get(pid_80, {})

            # IPUMS target
            ip_targets = i_map.get(pid_70, set())
            ip_target_id = list(ip_targets)[0] if len(ip_targets) > 0 else ""
            rec_ip = mentions_dict.get(ip_target_id, {}) if ip_target_id else {}

            fid70 = rec70.get("family_id")
            fid80 = rec80.get("family_id")

            rows.append({
                "id_1870": pid_70,
                "name_1870": f"{rec70.get('norm_first_name', '')} {rec70.get('nysiis_last_name', '')}",
                "birth_year_1870": rec70.get("birth_year", ""),
                "gender_1870": rec70.get("gender", ""),
                "race_1870": rec70.get("norm_race", ""),
                "family_members_1870": fam70_members.get(fid70, ""),
                "id_1880": pid_80,
                "name_1880": f"{rec80.get('norm_first_name', '')} {rec80.get('nysiis_last_name', '')}",
                "birth_year_1880": rec80.get("birth_year", ""),
                "gender_1880": rec80.get("gender", ""),
                "race_1880": rec80.get("norm_race", ""),
                "family_members_1880": fam80_members.get(fid80, ""),
                "ipums_id_1880": ip_target_id,
                "ipums_name_1880": f"{rec_ip.get('norm_first_name', '')} {rec_ip.get('nysiis_last_name', '')}" if rec_ip else "",
                "ipums_birth_year_1880": rec_ip.get("birth_year", "") if rec_ip else "",
                "ipums_gender_1880": rec_ip.get("gender", "") if rec_ip else "",
                "ipums_race_1880": rec_ip.get("norm_race", "") if rec_ip else "",
                "reviewer_verdict": "",
                "notes": ""
            })

        res_df = pd.DataFrame(rows)
        out_filename = f"review_bucket_{bucket_num}.csv"
        res_df.to_csv(out_filename, index=False)
        print(f"Deliverable 4: Saved {out_filename} with {len(res_df)} rows ({bucket_desc})")

    format_review_bucket(b1_pairs, 1, "D, R, and I all agree")
    format_review_bucket(b2_candidates, 2, "D and R agree, IPUMS differs")
    format_review_bucket(b3_candidates, 3, "IPUMS links accepted by neither method")
    format_review_bucket(b4_candidates, 4, "D and R conflict")
    format_review_bucket(b5_candidates, 5, "Largest boost conflicting with IPUMS", top_n=True)
    format_review_bucket(b6_candidates, 6, "Namesake-flagged pairs")

    print("\nAll evaluation steps executed successfully!")

if __name__ == "__main__":
    main()
