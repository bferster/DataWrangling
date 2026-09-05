"""
Convenience entry point for crosswalk script.
"""

import sys
import argparse
from TOOLS.crosswalk import run_crosswalk

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
