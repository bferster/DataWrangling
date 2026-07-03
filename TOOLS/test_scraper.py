import sys
from playwright.sync_api import sync_playwright

def main():
    url = "https://www.findagrave.com/memorial/search?fulltext=&firstname=&middlename=&lastname=&birthyear=1800&birthyearfilter=after&deathyear=1940&deathyearfilter=before&location=Augusta+County%2C+Virginia%2C+United+States+of+America&locationId=county_2810&bio=&linkedToName=&plot=&memorialid=&mcid=&datefilter=&orderby=d&includeTitles=true&page=1#sr-156032105"
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36")
        page.goto(url)
        page.wait_for_selector(".memorial-item") # Try to guess a selector, or just wait for load
        page.wait_for_timeout(3000)
        html = page.content()
        with open("page.html", "w", encoding="utf-8") as f:
            f.write(html)
        browser.close()

if __name__ == "__main__":
    main()
