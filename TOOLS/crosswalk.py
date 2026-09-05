"""
Census Crosswalk Script
Implements crosswalk matching between census years as specified in PROMPTS/crosswalk.md.
"""

import os
import sys
import csv
import re
import uuid
import argparse
import urllib.request
from typing import Dict, List, Tuple, Optional

CENSUS_URLS = {
    '1850': 'https://docs.google.com/spreadsheets/d/1fbLpHU6na8Ndb9K2GCb6ClQlf8RQZXb5AqSOUEA8Ad0/export?format=csv',
    '1860': 'https://docs.google.com/spreadsheets/d/1UsPJEPjg_Xfo0iqkmY0dvuw2mvzQH74Ou0VdxFryPVE/export?format=csv',
    '1870': 'https://docs.google.com/spreadsheets/d/1-pJ3MrWWEnPyrSNE8QxVi-EfxyO-oLhlwMudygU3HG8/export?format=csv',
    '1880': 'https://docs.google.com/spreadsheets/d/1W4Z4mu9LqnrxUhpAi5r2nxJgNFW2HLUhMbAohDzR7Qo/export?format=csv',
}

ASSERTION_SCHEMA = [
    'assertion_id',
    'subject_id',
    'predicate',
    'object_id',
    'start_year',
    'end_year',
    'who',
    'confidence'
]


def detect_years(header: List[str]) -> Tuple[str, str, int, int]:
    """
    Detect source and target years and their column indices from crosswalk header.
    Matches column formats like 'histid_1850' or 'histid1850'.
    Returns: (source_year, target_year, source_col_idx, target_col_idx)
    """
    pattern = re.compile(r'^histid_?(\d{4})$', re.IGNORECASE)
    found = []
    for idx, col in enumerate(header):
        m = pattern.match(col.strip())
        if m:
            found.append((m.group(1), idx))

    if len(found) < 2:
        raise ValueError(f"Could not find at least two histid_<year> columns in crosswalk header: {header}")

    # The two years present in the header
    source_year, source_idx = found[0]
    target_year, target_idx = found[1]
    return source_year, target_year, source_idx, target_idx


def load_census_transcript(year: str, county: str = 'AUG', cache_dir: str = 'cache', refresh: bool = False) -> Dict[str, str]:
    """
    Load census transcript for the given year and return a mapping:
        histid (normalized uppercase) -> mention_id
    """
    os.makedirs(cache_dir, exist_ok=True)
    cache_path = os.path.join(cache_dir, f'census_{year}.csv')

    if refresh or not os.path.exists(cache_path):
        if year not in CENSUS_URLS:
            raise ValueError(f"No Google Sheets URL configured for census year {year}")
        url = CENSUS_URLS[year]
        print(f"Downloading fresh census transcript for year {year} from Google Sheets...")
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as resp:
            content = resp.read().decode('utf-8', errors='ignore')
        with open(cache_path, 'w', encoding='utf-8', newline='') as f:
            f.write(content)
        print(f"Saved fresh {year} transcript to {cache_path}")
    else:
        print(f"Using cached transcript: {cache_path}")

    histid_to_mention: Dict[str, str] = {}

    with open(cache_path, 'r', encoding='utf-8-sig', errors='ignore') as f:
        reader = csv.DictReader(f)
        for row in reader:
            ipums_id = row.get('ipums_id', '').strip().upper()
            if not ipums_id:
                continue

            # Determine mention_id:
            # 1. From explicit 'mention_id' column if present
            # 2. Constructed canonical id: <county>-CN-<year>-<line>
            # 3. From 'id' column if present
            if row.get('mention_id', '').strip():
                mention_id = row['mention_id'].strip()
            elif row.get('line', '').strip():
                line = row['line'].strip()
                mention_id = f"{county}-CN-{year}-{line}"
            elif row.get('id', '').strip():
                mention_id = row['id'].strip()
            else:
                continue

            if ipums_id not in histid_to_mention:
                histid_to_mention[ipums_id] = mention_id

    print(f"Loaded {len(histid_to_mention)} unique histids for {year} (county: {county})")
    return histid_to_mention


def run_crosswalk(crosswalk_path: str = 'crosswalk.csv',
                  who: str = 'cnt',
                  county: str = 'AUG',
                  output_path: Optional[str] = None,
                  cache_dir: str = 'cache',
                  refresh: bool = False) -> Dict[str, int]:
    """
    Run crosswalk processing between census years.
    """
    if output_path is None:
        output_path = f"{county}-Crosswalk.csv"

    print("==================================================")
    print("CROSSWALK INGESTION")
    print(f"  Crosswalk file: {crosswalk_path}")
    print(f"  County code:    {county}")
    print(f"  Source/Method:  {who}")
    print(f"  Output file:    {output_path}")
    print(f"  Refresh cache:  {refresh}")
    print("==================================================")

    if not os.path.exists(crosswalk_path):
        raise FileNotFoundError(f"Crosswalk file not found: {crosswalk_path}")

    # 1. Identify source and target years from crosswalk header
    with open(crosswalk_path, 'r', encoding='utf-8-sig', errors='ignore') as f:
        reader = csv.reader(f)
        header = next(reader)

    source_year, target_year, source_idx, target_idx = detect_years(header)
    print(f"Detected years from header: {source_year} (col {source_idx}) and {target_year} (col {target_idx})")

    # 2. Load census transcripts into memory and build histid -> mention_id maps
    histid_to_mention_source = load_census_transcript(source_year, county, cache_dir, refresh=refresh)
    histid_to_mention_target = load_census_transcript(target_year, county, cache_dir, refresh=refresh)

    # 3. Determine earlier and later year for canonical isSameAs direction
    source_is_earlier = int(source_year) <= int(target_year)
    start_year = source_year if source_is_earlier else target_year
    end_year = target_year if source_is_earlier else source_year

    # 4. Open output file for appending (create with header if does not exist or empty)
    output_exists = os.path.exists(output_path) and os.path.getsize(output_path) > 0

    out_f = open(output_path, 'a', encoding='utf-8', newline='')
    writer = csv.writer(out_f)
    if not output_exists:
        writer.writerow(ASSERTION_SCHEMA)
        out_f.flush()

    # 5. Process crosswalk rows
    rows_read = 0
    rows_skipped_missing_histid = 0
    rows_skipped_source_not_in_transcript = 0
    rows_skipped_target_not_in_transcript = 0
    assertions_written = 0

    batch = []
    batch_size = 10000

    print(f"Processing {crosswalk_path}...")
    with open(crosswalk_path, 'r', encoding='utf-8-sig', errors='ignore') as in_f:
        reader = csv.reader(in_f)
        next(reader)  # Skip header row

        for row in reader:
            rows_read += 1

            if len(row) <= max(source_idx, target_idx):
                rows_skipped_missing_histid += 1
                continue

            src_histid = row[source_idx].strip().upper()
            tgt_histid = row[target_idx].strip().upper()

            # If either histid is missing or blank, skip
            if not src_histid or not tgt_histid:
                rows_skipped_missing_histid += 1
                continue

            # If histid_<source_year> is not present in histid_to_mention_source, skip
            if src_histid not in histid_to_mention_source:
                rows_skipped_source_not_in_transcript += 1
                continue

            # If histid_<target_year> is not present in histid_to_mention_target, skip
            if tgt_histid not in histid_to_mention_target:
                rows_skipped_target_not_in_transcript += 1
                continue

            # Resolve both histids to their mention_ids
            src_mention = histid_to_mention_source[src_histid]
            tgt_mention = histid_to_mention_target[tgt_histid]

            if source_is_earlier:
                subject_id = src_mention
                object_id = tgt_mention
            else:
                subject_id = tgt_mention
                object_id = src_mention

            assertion_id = str(uuid.uuid4())
            predicate = 'isSameAs'
            confidence = ''

            batch.append([
                assertion_id,
                subject_id,
                predicate,
                object_id,
                start_year,
                end_year,
                who,
                confidence
            ])
            assertions_written += 1

            if len(batch) >= batch_size:
                writer.writerows(batch)
                batch.clear()

        if batch:
            writer.writerows(batch)
            batch.clear()

    out_f.close()

    # 6. Report counts
    counts = {
        'rows_read': rows_read,
        'rows_skipped_missing_histid': rows_skipped_missing_histid,
        'rows_skipped_source_not_in_transcript': rows_skipped_source_not_in_transcript,
        'rows_skipped_target_not_in_transcript': rows_skipped_target_not_in_transcript,
        'assertions_written': assertions_written
    }

    print("\n---------------- Run Results ----------------")
    print(f"  Rows read:                                {rows_read:,}")
    print(f"  Rows skipped (missing histid):            {rows_skipped_missing_histid:,}")
    print(f"  Rows skipped (source not in transcript):  {rows_skipped_source_not_in_transcript:,}")
    print(f"  Rows skipped (target not in transcript):  {rows_skipped_target_not_in_transcript:,}")
    print(f"  Assertions written:                       {assertions_written:,}")
    print(f"  Output file:                              {output_path}")
    print("---------------------------------------------")

    return counts


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Crosswalk census records between census years.")
    parser.add_argument('--crosswalk', default='crosswalk.csv', help="Path to crosswalk CSV file")
    parser.add_argument('--version', '--who', dest='who', default='cnt',
                        help="Source/method identifier (e.g. cnt, clp, mlp, ver)")
    parser.add_argument('--county', default='AUG', help="County code (e.g. AUG)")
    parser.add_argument('--output', default=None, help="Output assertion CSV path (defaults to <county>-Crosswalk.csv)")
    parser.add_argument('--cache-dir', default='cache', help="Directory to cache downloaded census transcripts")
    parser.add_argument('--refresh', action='store_true', help="Force redownloading census transcripts from Google Sheets")

    args = parser.parse_args()
    run_crosswalk(
        crosswalk_path=args.crosswalk,
        who=args.who,
        county=args.county,
        output_path=args.output,
        cache_dir=args.cache_dir,
        refresh=args.refresh
    )
