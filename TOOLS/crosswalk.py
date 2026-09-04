"""
Census Crosswalk Script
Links census records across census years as specified in PROMPTS/crosswalk.md.
"""

import os
import sys
import csv
import re
import io
import argparse
import urllib.request
from typing import Dict, List, Tuple, Optional, Set

CENSUS_URLS = {
    '1850': 'https://docs.google.com/spreadsheets/d/1fbLpHU6na8Ndb9K2GCb6ClQlf8RQZXb5AqSOUEA8Ad0/export?format=csv',
    '1860': 'https://docs.google.com/spreadsheets/d/1UsPJEPjg_Xfo0iqkmY0dvuw2mvzQH74Ou0VdxFryPVE/export?format=csv',
    '1870': 'https://docs.google.com/spreadsheets/d/1-pJ3MrWWEnPyrSNE8QxVi-EfxyO-oLhlwMudygU3HG8/export?format=csv',
    '1880': 'https://docs.google.com/spreadsheets/d/1W4Z4mu9LqnrxUhpAi5r2nxJgNFW2HLUhMbAohDzR7Qo/export?format=csv',
}

DEFAULT_HEADER = [
    'id_1850', 'mlp_1850', 'cnt_1850', 'clp_1850',
    'id_1860', 'mlp_1860', 'cnt_1860', 'clp_1860',
    'id_1870', 'mlp_1870', 'cnt_1870', 'clp_1870',
    'id_1880', 'mlp_1880', 'cnt_1880', 'clp_1880',
    'id_1900', 'mlp_1900', 'cnt_1900', 'clp_1900'
]


def detect_years(header: List[str]) -> Tuple[str, str, str, str]:
    """
    Detect source and target years and their column names from crosswalk header.
    Returns: (source_year, target_year, source_col, target_col)
    """
    pattern = re.compile(r'^histid_?(\d{4})$', re.IGNORECASE)
    found = []
    for col in header:
        m = pattern.match(col.strip())
        if m:
            found.append((m.group(1), col))

    if len(found) < 2:
        raise ValueError(f"Could not find at least two histid_<year> columns in crosswalk header: {header}")

    # Sort by year ascending
    found.sort(key=lambda x: int(x[0]))
    source_year, source_col = found[0]
    target_year, target_col = found[1]
    return source_year, target_year, source_col, target_col


def load_census_transcript(year: str, cache_dir: str = 'cache') -> Tuple[List[Dict[str, str]], Dict[str, str], Dict[str, str]]:
    """
    Load census transcript for the given year.
    Caches downloaded file to `cache_dir/census_<year>.csv`.
    Returns:
        rows: List of all census row dictionaries (in transcript order)
        line_lookup: Map of histid (ipums_id) -> line number
        histid_lookup: Map of line number -> histid (ipums_id)
    """
    os.makedirs(cache_dir, exist_ok=True)
    cache_path = os.path.join(cache_dir, f'census_{year}.csv')

    if not os.path.exists(cache_path):
        if year not in CENSUS_URLS:
            raise ValueError(f"No Google Sheets URL configured for year {year}")
        url = CENSUS_URLS[year]
        print(f"Downloading census transcript for year {year} from Google Sheets...")
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as resp:
            content = resp.read().decode('utf-8', errors='ignore')
        with open(cache_path, 'w', encoding='utf-8', newline='') as f:
            f.write(content)
        print(f"Saved {year} transcript to {cache_path}")
    else:
        print(f"Using cached transcript: {cache_path}")

    with open(cache_path, 'r', encoding='utf-8', errors='ignore') as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    line_lookup: Dict[str, str] = {}
    histid_lookup: Dict[str, str] = {}

    for row in rows:
        ipums_id = row.get('ipums_id', '').strip()
        line = row.get('line', '').strip()
        if ipums_id and line:
            norm_id = ipums_id.upper()
            line_lookup[norm_id] = line
            histid_lookup[line] = norm_id

    print(f"Loaded {len(rows)} transcript rows for {year} ({len(line_lookup)} with valid ipums_id)")
    return rows, line_lookup, histid_lookup


def get_version_column(fieldnames: List[str], version: str, year: str) -> str:
    """
    Determine the column name in AUG-Crosswalk.csv for the given version and year.
    Handles 'ctn' <-> 'cnt' synonym.
    """
    cand1 = f"{version.lower()}_{year}"
    if cand1 in fieldnames:
        return cand1

    if version.lower() == 'ctn':
        cand2 = f"cnt_{year}"
        if cand2 in fieldnames:
            return cand2
    elif version.lower() == 'cnt':
        cand2 = f"ctn_{year}"
        if cand2 in fieldnames:
            return cand2

    if version.lower() in ('ctn', 'cnt'):
        return f"cnt_{year}" if f"cnt_{year}" in fieldnames else f"{version.lower()}_{year}"
    return cand1


def run_crosswalk(crosswalk_path: str = 'crosswalk.csv',
                  version: str = 'ctn',
                  output_path: str = 'AUG-Crosswalk.csv',
                  conflicts_path: str = 'AUG-Crosswalk-conflicts.csv',
                  cache_dir: str = 'cache') -> None:
    print(f"Starting crosswalk processing:")
    print(f"  Crosswalk file: {crosswalk_path}")
    print(f"  Version:        {version}")
    print(f"  Output:         {output_path}")
    print(f"  Conflicts:      {conflicts_path}")

    # 1. Identify source and target years from crosswalk header
    if not os.path.exists(crosswalk_path):
        raise FileNotFoundError(f"Crosswalk file not found: {crosswalk_path}")

    with open(crosswalk_path, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        header = next(reader)

    source_year, target_year, source_col, target_col = detect_years(header)
    source_idx = header.index(source_col)
    target_idx = header.index(target_col)
    print(f"Detected years from header: source={source_year} (col '{source_col}'), target={target_year} (col '{target_col}')")

    # 2. Load census transcripts into memory
    source_rows, line_lookup_source, histid_lookup_source = load_census_transcript(source_year, cache_dir)
    target_rows, line_lookup_target, histid_lookup_target = load_census_transcript(target_year, cache_dir)

    # 3. Stream crosswalk into memory for Augusta County records
    print(f"Scanning {crosswalk_path} for matches between {source_year} and {target_year} transcripts...")
    source_to_targets: Dict[str, List[str]] = {}

    with open(crosswalk_path, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        next(reader) # skip header
        for row in reader:
            if len(row) <= max(source_idx, target_idx):
                continue
            src_id = row[source_idx].strip().upper()
            tgt_id = row[target_idx].strip().upper()

            # Filter for records belonging to source & target census transcripts
            if src_id in line_lookup_source and tgt_id in line_lookup_target:
                if src_id not in source_to_targets:
                    source_to_targets[src_id] = []
                source_to_targets[src_id].append(tgt_id)

    total_matched_pairs = sum(len(v) for v in source_to_targets.values())
    print(f"Found {total_matched_pairs} crosswalk matches ({len(source_to_targets)} unique sources) between {source_year} and {target_year} transcripts.")

    # 4. Load existing AUG-Crosswalk.csv
    existing_rows: List[Dict[str, str]] = []
    fieldnames = list(DEFAULT_HEADER)

    if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
        with open(output_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            if reader.fieldnames:
                fieldnames = list(reader.fieldnames)
            existing_rows = list(reader)
        print(f"Loaded existing {output_path} with {len(existing_rows)} rows.")
    else:
        print(f"Initializing new {output_path} with {len(fieldnames)} columns.")

    # Determine version columns
    src_cw_col = get_version_column(fieldnames, version, source_year)
    tgt_cw_col = get_version_column(fieldnames, version, target_year)
    src_id_col = f"id_{source_year}"
    tgt_id_col = f"id_{target_year}"

    # Ensure all required columns are in fieldnames
    for col in [src_id_col, tgt_id_col, src_cw_col, tgt_cw_col]:
        if col not in fieldnames:
            fieldnames.append(col)

    # 5. Build histid index for each year present in AUG-Crosswalk.csv
    # Maps: year -> { histid: row_index }
    histid_indexes: Dict[str, Dict[str, int]] = {}
    all_years = set()
    for col in fieldnames:
        m = re.match(r'^(?:id|mlp|cnt|clp|ctn)_(\d{4})$', col)
        if m:
            all_years.add(m.group(1))

    # Lookups for all known years if available in cache or memory
    known_line_lookups: Dict[str, Dict[str, str]] = {
        source_year: line_lookup_source,
        target_year: line_lookup_target
    }
    known_histid_lookups: Dict[str, Dict[str, str]] = {
        source_year: histid_lookup_source,
        target_year: histid_lookup_target
    }

    for y in all_years:
        if y not in known_histid_lookups and os.path.exists(os.path.join(cache_dir, f'census_{y}.csv')):
            _, l_map, h_map = load_census_transcript(y, cache_dir)
            known_line_lookups[y] = l_map
            known_histid_lookups[y] = h_map

    for y in all_years:
        histid_indexes[y] = {}

    for idx, r in enumerate(existing_rows):
        for y in all_years:
            y_id_col = f"id_{y}"
            if y_id_col in r and r[y_id_col].strip():
                line_val = r[y_id_col].strip()
                if y in known_histid_lookups and line_val in known_histid_lookups[y]:
                    hid = known_histid_lookups[y][line_val]
                    histid_indexes[y][hid] = idx

            # Also check cw*_<year> columns
            for col_name, col_val in r.items():
                if col_name != y_id_col and col_name.endswith(f"_{y}") and col_val.strip():
                    hid = col_val.strip().upper()
                    histid_indexes[y][hid] = idx

    conflicts: List[Dict[str, str]] = []
    stats = {
        'total_source_census_rows': len(source_rows),
        'skipped_no_match': 0,
        'already_recorded': 0,
        'updated_existing_source': 0,
        'updated_existing_target': 0,
        'created_new_row': 0,
        'conflicts': 0
    }

    # 6. For each row in the source census
    for row in source_rows:
        ipums_id = row.get('ipums_id', '').strip()
        if not ipums_id:
            stats['skipped_no_match'] += 1
            continue

        src_histid = ipums_id.upper()
        if src_histid not in source_to_targets:
            # No match in crosswalk file
            stats['skipped_no_match'] += 1
            continue

        for tgt_histid in source_to_targets[src_histid]:
            if src_histid not in line_lookup_source or tgt_histid not in line_lookup_target:
                stats['skipped_no_match'] += 1
                continue

            src_line = line_lookup_source[src_histid]
            tgt_line = line_lookup_target[tgt_histid]

            # Look up src_histid in source_year's existing histid index
            # Look up tgt_histid in target_year's existing histid index
            src_row_idx = histid_indexes.get(source_year, {}).get(src_histid)
            tgt_row_idx = histid_indexes.get(target_year, {}).get(tgt_histid)

            if src_row_idx is not None and tgt_row_idx is not None:
                if src_row_idx == tgt_row_idx:
                    # Both found in same row: ensure crosswalk columns are recorded
                    r = existing_rows[src_row_idx]
                    if not r.get(src_cw_col):
                        r[src_cw_col] = src_histid
                    if not r.get(tgt_cw_col):
                        r[tgt_cw_col] = tgt_histid
                    stats['already_recorded'] += 1
                else:
                    # Both found, but in DIFFERENT existing rows -> Conflict!
                    stats['conflicts'] += 1
                    conflicts.append({
                        'source_year': source_year,
                        'target_year': target_year,
                        'histid_source': src_histid,
                        'line_source': src_line,
                        'histid_target': tgt_histid,
                        'line_target': tgt_line,
                        'source_row_index': str(src_row_idx),
                        'target_row_index': str(tgt_row_idx),
                        'reason': f"Source histid in row {src_row_idx}, target histid in row {tgt_row_idx}"
                    })
            elif src_row_idx is not None and tgt_row_idx is None:
                # Source found in existing row, target is not
                r = existing_rows[src_row_idx]
                if r.get(tgt_id_col) and r[tgt_id_col].strip() and r[tgt_id_col].strip() != tgt_line:
                    # Conflict: this row already has a different target line recorded
                    stats['conflicts'] += 1
                    conflicts.append({
                        'source_year': source_year,
                        'target_year': target_year,
                        'histid_source': src_histid,
                        'line_source': src_line,
                        'histid_target': tgt_histid,
                        'line_target': tgt_line,
                        'source_row_index': str(src_row_idx),
                        'target_row_index': '',
                        'reason': f"Source row {src_row_idx} already has {tgt_id_col}={r[tgt_id_col]} (conflicts with target line {tgt_line})"
                    })
                else:
                    r[tgt_id_col] = tgt_line
                    r[tgt_cw_col] = tgt_histid
                    if not r.get(src_cw_col):
                        r[src_cw_col] = src_histid
                    histid_indexes[target_year][tgt_histid] = src_row_idx
                    stats['updated_existing_source'] += 1
            elif src_row_idx is None and tgt_row_idx is not None:
                # Target found in existing row, source is not
                r = existing_rows[tgt_row_idx]
                if r.get(src_id_col) and r[src_id_col].strip() and r[src_id_col].strip() != src_line:
                    # Conflict: existing row already has a different source line
                    stats['conflicts'] += 1
                    conflicts.append({
                        'source_year': source_year,
                        'target_year': target_year,
                        'histid_source': src_histid,
                        'line_source': src_line,
                        'histid_target': tgt_histid,
                        'line_target': tgt_line,
                        'source_row_index': '',
                        'target_row_index': str(tgt_row_idx),
                        'reason': f"Target in row {tgt_row_idx} already has {src_id_col}={r[src_id_col]} (conflicts with source line {src_line})"
                    })
                else:
                    r[src_id_col] = src_line
                    r[src_cw_col] = src_histid
                    if not r.get(tgt_cw_col):
                        r[tgt_cw_col] = tgt_histid
                    histid_indexes[source_year][src_histid] = tgt_row_idx
                    stats['updated_existing_target'] += 1
            else:
                # Neither found: create one new row
                new_idx = len(existing_rows)
                new_row = {col: '' for col in fieldnames}
                new_row[src_id_col] = src_line
                new_row[src_cw_col] = src_histid
                new_row[tgt_id_col] = tgt_line
                new_row[tgt_cw_col] = tgt_histid

                existing_rows.append(new_row)
                histid_indexes[source_year][src_histid] = new_idx
                histid_indexes[target_year][tgt_histid] = new_idx
                stats['created_new_row'] += 1

    # 7. Write output to AUG-Crosswalk.csv
    print(f"Writing {len(existing_rows)} rows to {output_path}...")
    with open(output_path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(existing_rows)

    # 8. Write conflicts if any
    if conflicts:
        conflict_fields = [
            'source_year', 'target_year',
            'histid_source', 'line_source',
            'histid_target', 'line_target',
            'source_row_index', 'target_row_index',
            'reason'
        ]
        with open(conflicts_path, 'w', encoding='utf-8', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=conflict_fields)
            writer.writeheader()
            writer.writerows(conflicts)
        print(f"Logged {len(conflicts)} conflicts to {conflicts_path}.")
    else:
        print("No conflicts detected.")
        if os.path.exists(conflicts_path):
            os.remove(conflicts_path)

    print("\nExecution Summary:")
    for k, v in stats.items():
        print(f"  {k:30s}: {v}")
    print(f"Total rows in {output_path}: {len(existing_rows)}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Crosswalk between census years.")
    parser.add_argument('--crosswalk', default='crosswalk.csv', help="Path to crosswalk CSV")
    parser.add_argument('--version', default='ctn', help="Crosswalk version prefix (e.g. ctn, mlp, clp)")
    parser.add_argument('--output', default='AUG-Crosswalk.csv', help="Path to AUG-Crosswalk.csv")
    parser.add_argument('--conflicts', default='AUG-Crosswalk-conflicts.csv', help="Path to conflicts CSV")
    parser.add_argument('--cache-dir', default='cache', help="Directory to cache downloaded census files")

    args = parser.parse_args()
    run_crosswalk(args.crosswalk, args.version, args.output, args.conflicts, args.cache_dir)
