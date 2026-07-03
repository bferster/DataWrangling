import csv
import re
import PyPDF2
import sys

def convert_height(height_str):
    if not height_str:
        return ""
    # Look for patterns like "5 ft 8 in", "5 ft", "5 ft 8.5 in"
    ft_match = re.search(r'(\d+)\s*ft', height_str, re.IGNORECASE)
    in_match = re.search(r'([\d\.]+)\s*in', height_str, re.IGNORECASE)
    
    total_inches = 0.0
    if ft_match:
        total_inches += float(ft_match.group(1)) * 12
    if in_match:
        total_inches += float(in_match.group(1))
        
    if total_inches > 0:
        return str(total_inches)
    return height_str # fallback if it doesn't match

def extract_year(date_str):
    if not date_str:
        return ""
    match = re.search(r'(\d{4})', date_str)
    if match:
        return match.group(1)
    return ""

def extract_data_to_csv(pdf_path, csv_path):
    text = ""
    with open(pdf_path, 'rb') as f:
        reader = PyPDF2.PdfReader(f)
        for page in reader.pages:
            text += page.extract_text() + "\n"
            
    records = re.split(r'\n(?=(?:[0-9/]+)?Name:\s)', text)
    
    parsed_data = []
    seen = set() # For deduplication
    
    for record in records:
        if "Name:" not in record:
            continue
            
        data = {
            "Name": "",
            "Age": "",
            "Sex": "",
            "Color": "",
            "Height": "",
            "Registration Number": "",
            "Registration Date": "",
            "Additional Info": ""
        }
        
        name_match = re.search(r'Name:\s*(.*)', record)
        if name_match:
            data["Name"] = name_match.group(1).strip()
            
        age_match = re.search(r'Age:\s*(.*)', record)
        if age_match:
            data["Age"] = age_match.group(1).strip()
            
        sex_match = re.search(r'Sex:\s*(.*)', record)
        if sex_match:
            data["Sex"] = sex_match.group(1).strip()
            
        color_match = re.search(r'Color:\s*(.*)', record)
        if color_match:
            data["Color"] = color_match.group(1).strip()
            
        height_match = re.search(r'Height:\s*(.*)', record)
        if height_match:
            data["Height"] = convert_height(height_match.group(1).strip())
            
        reg_num_match = re.search(r'Registration number:\s*(.*)', record, re.IGNORECASE)
        if reg_num_match:
            data["Registration Number"] = reg_num_match.group(1).strip()
            
        reg_date_match = re.search(r'Registration date:\s*(.*)', record, re.IGNORECASE)
        if reg_date_match:
            data["Registration Date"] = reg_date_match.group(1).strip()
            
        add_info_match = re.search(r'Additional Info:\s*([\s\S]*?)(?=\n[A-Za-z\s]+:|\Z)', record, re.IGNORECASE)
        if add_info_match:
            info = add_info_match.group(1).replace('\n', ' ').strip()
            data["Additional Info"] = info
            
        # Add new derived columns
        data["Registration Year"] = extract_year(data["Registration Date"])
        
        data["Birth Year"] = ""
        if data["Age"] and data["Registration Year"]:
            try:
                age_val = float(data["Age"])
                year_val = int(data["Registration Year"])
                data["Birth Year"] = str(int(year_val - age_val))
            except ValueError:
                pass
                
        # Deduplication check using a tuple of values
        row_tuple = tuple(data.items())
        if row_tuple not in seen:
            seen.add(row_tuple)
            parsed_data.append(data)
        
    with open(csv_path, 'w', newline='', encoding='utf-8') as f:
        fieldnames = ["Name", "Age", "Sex", "Color", "Height", "Registration Number", "Registration Date", "Registration Year", "Birth Year", "Additional Info"]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in parsed_data:
            writer.writerow(row)
            
    print(f"Successfully extracted {len(parsed_data)} records to {csv_path} (duplicates removed)")

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print("Usage: python extract_registry.py <input.pdf> <output.csv>")
        sys.exit(1)
    
    input_pdf = sys.argv[1]
    output_csv = sys.argv[2]
    extract_data_to_csv(input_pdf, output_csv)
