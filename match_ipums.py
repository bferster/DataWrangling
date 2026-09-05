import sys
import os
from TOOLS.match_ipums import run_matcher
import argparse

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Match IPUMS data to Census CSV.")
    parser.add_argument('--census', default='census.csv', help='Path to census.csv')
    parser.add_argument('--ipums', default='ipums.csv', help='Path to ipums.csv')
    parser.add_argument('--output', default='census.csv', help='Path to output census CSV')
    args = parser.parse_args()

    run_matcher(args.census, args.ipums, args.output)
