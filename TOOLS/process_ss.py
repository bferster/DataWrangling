import csv
import json
import os

myCounty = "ALB"
myYear = "1850"
myData = "albSS1850.csv"

# Input and output paths
data_dir = "DATA"
if not os.path.exists(data_dir):
    os.makedirs(data_dir)

input_file = myData
mentions_output = os.path.join(data_dir, "resultsMentions.csv")
assertions_output = os.path.join(data_dir, "resultsAssertions.csv")

mentions = []
assertions = []
mention_counts = {}
owner_lookup = {}

current_owner_mention_id = None
current_owner_name = None
current_household_num = 0
current_household_id = ""

source_str = f"{myCounty}-SS-{myYear}"

def get_mention_id(line_num):
    base_id = f"{myCounty}-SS-{myYear}-{line_num}"
    if base_id not in mention_counts:
        mention_counts[base_id] = 1
        return base_id
    else:
        mention_counts[base_id] += 1
        return f"{base_id}.{mention_counts[base_id]}"

with open(input_file, "r", encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    added_owners = set()
    
    for row in reader:
        line_num = row.get("line", "")
        status = row.get("status", "").strip()
        full_name = row.get("full_name", "").strip()
        
        mention_id = get_mention_id(line_num)
        
        if status == "Owner":
            current_owner_name = full_name
            current_owner_mention_id = mention_id
            
            # Create new household_id
            current_household_num += 1
            current_household_id = f"HS{myYear}-{current_household_num}"
            
            if full_name not in added_owners:
                added_owners.add(full_name)
                owner_lookup[full_name] = mention_id
                
                mentions.append({
                    "mention_id": mention_id,
                    "source": source_str,
                    "full_name": full_name,
                    "first_name": row.get("first_name", ""),
                    "middle_name": row.get("middle_name", ""),
                    "last_name": row.get("last_name", ""),
                    "age": "",
                    "birth_year": "",
                    "gender": "",
                    "race": "",
                    "head": "Y",
                    "legal_status": "",
                    "household_id": current_household_id
                })
        else:
            # Enslaved person
            mentions.append({
                "mention_id": mention_id,
                "source": source_str,
                "full_name": full_name,
                "first_name": row.get("first_name", ""),
                "middle_name": row.get("middle_name", ""),
                "last_name": row.get("last_name", ""),
                "age": row.get("age", ""),
                "birth_year": row.get("birth_year", ""),
                "gender": row.get("gender", ""),
                "race": row.get("race", ""),
                "head": "",
                "legal_status": "E",
                "household_id": current_household_id
            })
            
            if current_owner_name and current_owner_name in owner_lookup:
                owner_id = owner_lookup[current_owner_name]
                assertions.append({
                    "subject": mention_id,
                    "predicate": "wasEnslavedBy",
                    "object": owner_id,
                    "who": "SS",
                    "start_year": myYear,
                    "end_year": "",
                    "confidence": "0.83"
                })

# Write mentions
with open(mentions_output, "w", encoding="utf-8", newline="") as f:
    fieldnames = ["mention_id", "source", "full_name", "first_name", "middle_name", "last_name", "age", "birth_year", "gender", "race", "head", "legal_status", "household_id"]
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(mentions)

# Write assertions
with open(assertions_output, "w", encoding="utf-8", newline="") as f:
    fieldnames = ["subject", "predicate", "object", "who", "start_year", "end_year", "confidence"]
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(assertions)

print("Data processing complete with household IDs, head, and source fields.")
