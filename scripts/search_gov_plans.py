import urllib.request
import urllib.parse
import json
import re

def search_ddg(query):
    url = "https://html.duckduckgo.com/html/?q=" + urllib.parse.quote(query)
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    })
    try:
        html = urllib.request.urlopen(req, timeout=10).read().decode('utf-8', errors='ignore')
        # find uddg= links
        links = re.findall(r'uddg=([^&"\']+)', html)
        decoded = [urllib.parse.unquote(l) for l in links if l.lower().endswith('.pdf') or '.pdf?' in l.lower()]
        return decoded
    except Exception as e:
        print(f"Error searching {query}: {e}")
        return []

def main():
    queries = [
        '"electrical" "switchgear" "plan" "drawing" filetype:pdf site:gov',
        '"mechanical room" "penthouse" "drawing" filetype:pdf site:gov',
        '"subcontractor" "bid proposal" "electrical" filetype:pdf site:gov',
        '"trade contractor" "bid proposal" filetype:pdf site:gov',
        '"electrical contractor" "bid proposal" filetype:pdf site:gov',
    ]
    for q in queries:
        print(f"\n--- Query: {q} ---")
        urls = search_ddg(q)
        for u in urls[:5]:
            print("  PDF:", u)

if __name__ == "__main__":
    main()
