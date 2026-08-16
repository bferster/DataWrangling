import os
import shutil
import time
import csv
import re
from playwright.sync_api import sync_playwright

def copy_minimal_profile(src_user_data, dst_user_data, profile_dir="Default"):
    if os.path.exists(dst_user_data):
        shutil.rmtree(dst_user_data, ignore_errors=True)
    os.makedirs(dst_user_data, exist_ok=True)
    
    local_state_src = os.path.join(src_user_data, "Local State")
    local_state_dst = os.path.join(dst_user_data, "Local State")
    if os.path.exists(local_state_src):
        try:
            shutil.copy2(local_state_src, local_state_dst)
        except Exception:
            pass
            
    default_src = os.path.join(src_user_data, profile_dir)
    default_dst = os.path.join(dst_user_data, profile_dir)
    os.makedirs(default_dst, exist_ok=True)
    
    essential_files = ["Preferences", "Web Data", "Login Data"]
    for file in essential_files:
        src_file = os.path.join(default_src, file)
        dst_file = os.path.join(default_dst, file)
        if os.path.exists(src_file):
            try:
                shutil.copy2(src_file, dst_file)
            except Exception:
                pass
                
    network_src = os.path.join(default_src, "Network")
    network_dst = os.path.join(default_dst, "Network")
    os.makedirs(network_dst, exist_ok=True)
    cookies_src = os.path.join(network_src, "Cookies")
    cookies_dst = os.path.join(network_dst, "Cookies")
    
    # We will loop and wait for this file to be copied successfully
    copied = False
    while not copied:
        if os.path.exists(cookies_src):
            try:
                shutil.copy2(cookies_src, cookies_dst)
                copied = True
                print("Successfully copied Chrome cookies!", flush=True)
            except Exception as e:
                print("Waiting for Google Chrome to close to copy session cookies... (Press Ctrl+C to stop)", flush=True)
                time.sleep(2)
        else:
            print("Chrome cookies file not found.", flush=True)
            break

def clean_value(val):
    if not val:
        return ""
    # Remove all punctuation and special characters from name and location, except quotes
    # Also remove extra spaces
    cleaned = re.sub(r'[^\w\s\'"“”‘’]', '', val).replace('_', '')
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned

def main():
    src_user_data = os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\User Data")
    dst_user_data = os.path.abspath("./temp_chrome_user_data")
    
    copy_minimal_profile(src_user_data, dst_user_data, "Default")
    
    url = "https://www.ancestry.com/imageviewer/collections/62153/images/62153_i1023851-00002?usePUB=true&_phsrc=Fww36"
    
    with sync_playwright() as p:
        try:
            print("Launching chrome using copied profile...", flush=True)
            context = p.chromium.launch_persistent_context(
                dst_user_data,
                channel="chrome",
                headless=False,
                args=["--profile-directory=Default"]
            )
            page = context.new_page()
            print(f"Navigating to: {url}", flush=True)
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            
            # Wait for 10 seconds for initial load
            page.wait_for_timeout(10000)
            
            print("Current URL:", page.url)
            print("Page Title:", page.title())
            
            if "offers/join" in page.url or "Access denied" in page.title():
                print("Redirection or access denied detected. Cookies might have expired or profile was invalid.", flush=True)
                page.screenshot(path="scrape_failure.png")
                context.close()
                return

            # Wait for index panel to be visible or let's try to locate the elements
            print("Looking for transcription/index elements...", flush=True)
            
            # Let's write the scraper loop and page extraction
            output_csv = "ancestry_records.csv"
            
            headers = [
                "line", "full_name", "maiden_name", "gender", "race", 
                "residence_age", "death_age", "birth_date", "birth_place", 
                "residence_place", "death_date", "enslaver", "enslaved_person", 
                "father", "mother", "spouse", "child", "occupation", "status", "notes"
            ]
            
            with open(output_csv, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow(headers)
                
                line_num = 1
                page_num = 1
                
                while True:
                    print(f"Scraping page {page_num}...", flush=True)
                    
                    # Wait a bit for rows to render
                    page.wait_for_timeout(3000)
                    
                    # Let's extract rows using JavaScript evaluation
                    # We look for table rows or list items in the transcription panel.
                    # In Ancestry's image viewer, the transcription panel typically has class names like 'transcription-panel', or tables.
                    # Let's execute JS to inspect the DOM and find the records table.
                    extract_js = """
                    () => {
                        // Try to find the table in the transcription/index area
                        let table = document.querySelector('.transcription-panel table, #transcription-panel table, table');
                        if (!table) {
                            // Try finding any table or grid rows
                            const rows = Array.from(document.querySelectorAll('tr, [role="row"]'));
                            if (rows.length > 0) {
                                return rows.map(r => Array.from(r.querySelectorAll('td, [role="gridcell"]')).map(c => c.innerText));
                            }
                            return [];
                        }
                        
                        let rows = Array.from(table.querySelectorAll('tr'));
                        // Skip header row if it has th
                        if (rows.length > 0 && rows[0].querySelector('th')) {
                            rows.shift();
                        }
                        return rows.map(r => Array.from(r.querySelectorAll('td')).map(c => c.innerText));
                    }
                    """
                    
                    rows = page.evaluate(extract_js)
                    print(f"Extracted {len(rows)} raw rows.", flush=True)
                    
                    valid_rows_on_page = 0
                    for row in rows:
                        # Ancestry rows might have multiple columns.
                        # Let's see how many columns they have. We map them to the 19 fields in Ancestry.md:
                        # 0: Name, 1: Maiden Name, 2: Gender, 3: Race, 4: Residence Age, 5: Death Age, 6: Birth Date, 
                        # 7: Birth Place, 8: Residence Place, 9: Death Date, 10: Enslaver, 11: Enslaved Person,
                        # 12: Father, 13: Mother, 14: Spouse, 15: Child, 16: Occupation, 17: Status, 18: Notes
                        if not row or all(not col.strip() for col in row):
                            continue
                            
                        # Pad row to at least 19 elements
                        while len(row) < 19:
                            row.append("")
                            
                        full_name = clean_value(row[0])
                        maiden_name = row[1].strip()
                        gender = row[2].strip()
                        race = row[3].strip()
                        residence_age = row[4].strip()
                        death_age = row[5].strip()
                        birth_date = row[6].strip()
                        birth_place = clean_value(row[7])
                        residence_place = clean_value(row[8])
                        death_date = row[9].strip()
                        enslaver = row[10].strip()
                        enslaved_person = row[11].strip()
                        father = row[12].strip()
                        mother = row[13].strip()
                        spouse = row[14].strip()
                        child = row[15].strip()
                        occupation = row[16].strip()
                        status = row[17].strip()
                        notes = row[18].strip()
                        
                        # Rule: "Don't add row if all fields are empty."
                        fields = [
                            full_name, maiden_name, gender, race, residence_age, death_age, 
                            birth_date, birth_place, residence_place, death_date, enslaver, 
                            enslaved_person, father, mother, spouse, child, occupation, status, notes
                        ]
                        if all(not field for field in fields):
                            continue
                            
                        writer.writerow([line_num] + fields)
                        line_num += 1
                        valid_rows_on_page += 1
                        
                    print(f"Saved {valid_rows_on_page} valid rows.", flush=True)
                    f.flush()
                    
                    if page_num >= 3:
                        print("Scraped 3 pages as requested. Stopping.", flush=True)
                        break
                        
                    # Check for ">" button (Next page of results)
                    # We can look for buttons or links with aria-label="Next page", or containing ">", or with class names like next
                    next_click_js = """
                    () => {
                        // Common Ancestry next page button selectors
                        let btn = document.querySelector('button[aria-label="Next page"], .next-button, button.next, [data-testid="next-button"]');
                        if (!btn) {
                            // Find by text content or icon
                            const buttons = Array.from(document.querySelectorAll('button, a'));
                            btn = buttons.find(b => b.innerText.trim() === '>' || b.innerText.trim().toLowerCase() === 'next');
                        }
                        if (btn && !btn.disabled && !btn.classList.contains('disabled')) {
                            btn.click();
                            return true;
                        }
                        return false;
                    }
                    """
                    clicked = page.evaluate(next_click_js)
                    if not clicked:
                        print("No next button found or it is disabled. Scraping complete.", flush=True)
                        break
                        
                    page_num += 1
                    
            context.close()
            print(f"Scrape completed successfully. Output saved to {output_csv}", flush=True)
        except Exception as e:
            print("Error during scraping:", e)
        finally:
            shutil.rmtree(dst_user_data, ignore_errors=True)

if __name__ == "__main__":
    main()
