"""
Match IPUMS extract records to census transcription CSV.
Follows the specification in PROMPTS/IPUMS2Census.md.

Usage:
    python match_ipums.py
    python match_ipums.py --census census.csv --ipums ipubs.csv --output census.csv
"""

import sys
import os

# Delegate to TOOLS/match_ipums.py
tools_dir = os.path.join(os.path.dirname(__file__), 'TOOLS')
sys.path.insert(0, tools_dir)

from match_ipums import run_matcher
import argparse

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Match IPUMS data to Census CSV.")
    parser.add_argument('--census', default='census.csv', help='Path to census.csv')
    parser.add_argument('--ipums', default='ipums.csv', help='Path to ipums.csv (or ipubs.csv)')
    parser.add_argument('--output', default='census.csv', help='Path to output census CSV')
    args = parser.parse_args()

    run_matcher(args.census, args.ipums, args.output)
