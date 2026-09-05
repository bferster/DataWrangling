"""
Convert SPSS .sav file to CSV.
Preserves integer representations for numeric codes (F*.0 types) and streams in chunks.
"""

import sys
import os
import time
import argparse
import pyreadstat
import pandas as pd

import warnings
warnings.filterwarnings('ignore', category=UserWarning)

def convert_sav_to_csv(input_path, output_path, chunksize=250000):
    start_time = time.time()
    print(f"Reading metadata from: {input_path}")
    _, meta = pyreadstat.read_sav(input_path, metadataonly=True)
    total_rows = meta.number_rows
    print(f"Total rows: {total_rows:,}")
    print(f"Columns ({len(meta.column_names)}): {meta.column_names}")

    float_cols = [col for col, f in meta.original_variable_types.items() if f.startswith('F') and f.endswith('.0')]

    print(f"Streaming conversion to: {output_path}")
    reader = pyreadstat.read_file_in_chunks(pyreadstat.read_sav, input_path, chunksize=chunksize)

    rows_written = 0
    first_chunk = True

    for chunk_df, _ in reader:
        # Convert integer float columns to Int64 to avoid ugly .0 in CSV
        for col in float_cols:
            if col in chunk_df.columns:
                chunk_df[col] = chunk_df[col].astype('Int64')

        # Clean string columns: strip whitespace
        for col in chunk_df.columns:
            if col not in float_cols:
                if chunk_df[col].dtype == object or pd.api.types.is_string_dtype(chunk_df[col]):
                    chunk_df[col] = chunk_df[col].astype(str).str.strip().replace({'nan': '', 'None': ''})

        # Write to CSV
        mode = 'w' if first_chunk else 'a'
        header = first_chunk
        chunk_df.to_csv(output_path, mode=mode, header=header, index=False)
        first_chunk = False

        rows_written += len(chunk_df)
        pct = (rows_written / total_rows) * 100 if total_rows else 0
        elapsed = time.time() - start_time
        print(f"Written {rows_written:,} / {total_rows:,} rows ({pct:.1f}%) in {elapsed:.1f}s")

    file_size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"\nConversion complete!")
    print(f"Output file: {output_path} ({file_size_mb:.1f} MB, {rows_written:,} rows)")
    print(f"Total time elapsed: {time.time() - start_time:.2f} seconds")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Convert SPSS .sav file to CSV.")
    parser.add_argument('--input', default='slave_1850.sav', help='Path to input .sav file')
    parser.add_argument('--output', default='slave_1850.csv', help='Path to output .csv file')
    parser.add_argument('--chunksize', type=int, default=250000, help='Chunk size for streaming conversion')
    args = parser.parse_args()

    convert_sav_to_csv(args.input, args.output, args.chunksize)
