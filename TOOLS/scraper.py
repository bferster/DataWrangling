import csv
import re
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

def scrape_findagrave(start_url, output_csv):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36")
        
        # open with write mode
        with open(output_csv, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["line", "full_name", "birth_year", "death_year", "location"])
            
            page_num = 1
            line_num = 1
            while True:
                print(f"Scraping page {page_num}...", flush=True)
                
                # Fetch page
                current_url = start_url + f"&page={page_num}" if "page=" not in start_url else start_url.replace("page=1", f"page={page_num}")
                try:
                    page.goto(current_url, wait_until="domcontentloaded", timeout=60000)
                except Exception as e:
                    print(f"Failed to load page {page_num}: {e}", flush=True)
                    break

                # Wait for items to load
                try:
                    page.wait_for_selector(".memorial-item", timeout=15000)
                except Exception as e:
                    print("Could not find memorial items on this page or timeout.", e)
                    break
                
                # small wait to ensure all elements are rendered
                page.wait_for_timeout(2000)
                
                html = page.content()
                soup = BeautifulSoup(html, 'html.parser')
                
                items = soup.select(".memorial-item")
                for item in items:
                    name_grave = item.select_one(".name-grave")
                    if name_grave:
                        div = name_grave.find("div")
                        if div: div.extract()
                        
                        full_name = name_grave.get_text(separator=' ', strip=True)
                    else:
                        full_name = ""
                        
                    bd_dates = item.select_one(".birthDeathDates")
                    bd_text = bd_dates.get_text(strip=True) if bd_dates else ""
                    years = re.findall(r'\b\d{4}\b', bd_text)
                    birth_year = years[0] if len(years) > 0 else ""
                    death_year = years[1] if len(years) > 1 else ""
                    
                    loc_el = item.select_one(".memorial-item---cemet p.addr-cemet")
                    location = loc_el.get_text(separator=' ', strip=True) if loc_el else ""
                    
                    # Apply cleaning rules
                    prefixes = ["PVT ", "COL ", "SGT ", "MR ", "DR ", "CAPT ", "MRS ", "LTC ", "LT ", "CPL ", "PFC ", "REV ", "1SGT ", "CPT ", "MAJ ", "GEN ", "ENS ", "CORP "]
                    prefixes.sort(key=len, reverse=True)
                    
                    changed = True
                    while changed:
                        changed = False
                        for p in prefixes:
                            if full_name.upper().startswith(p.upper()) or full_name.upper().startswith(p.upper().strip() + ".") or full_name.upper().startswith(p.upper().strip() + " "):
                                full_name = full_name[len(p.strip()):].lstrip(". ")
                                changed = True
                                break
                    
                    full_name = re.sub(r'[^\w\s\'"“”‘’]', '', full_name).replace('_', '')
                    location = re.sub(r'[^\w\s\'"“”‘’]', '', location).replace('_', '')
                    
                    full_name = re.sub(r'\s+', ' ', full_name).strip()
                    location = re.sub(r'\s+', ' ', location).strip()
                    
                    if not (full_name or birth_year or death_year or location):
                        continue
                        
                    writer.writerow([line_num, full_name, birth_year, death_year, location])
                    line_num += 1
                
                f.flush() # force write to disk
                print(f"Page {page_num} finished scraping.", flush=True)
                
                # Look for the next button
                # FindAGrave uses #load-next-page for its "Next Page" button
                next_buttons = page.locator('#load-next-page')
                
                if next_buttons.count() > 0:
                    next_btn = next_buttons.first
                    is_disabled = next_btn.evaluate('el => el.disabled || el.classList.contains("disabled")')
                    if not is_disabled:
                        # FindAGrave loads the next page via JS and updates the DOM, or navigates.
                        page_num += 1
                        continue
                        
                print("No more pages or next button disabled.")
                break
                
        browser.close()

if __name__ == "__main__":
    start = "https://www.findagrave.com/memorial/search?fulltext=&firstname=&middlename=&lastname=&birthyear=1750&birthyearfilter=after&deathyear=1950&deathyearfilter=before&location=Albemarle+County%2C+Virginia%2C+United+States+of+America&locationId=county_2804&bio=&linkedToName=&plot=&memorialid=&mcid=&datefilter=&orderby=b&includeNickName=true&includeMaidenName=true&includeTitles=true&exactName=true&page=1"
    scrape_findagrave(start, "results.csv")
    print("Scraping completed. Results saved to results.csv")
