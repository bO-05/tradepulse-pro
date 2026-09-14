import urllib.request
import urllib.parse
import re
import sys

def search(q):
    url = 'https://html.duckduckgo.com/html/?q=' + urllib.parse.quote(q)
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            html = r.read().decode('utf-8', errors='ignore')
        uddg = re.findall(r'//duckduckgo\.com/l/\?uddg=([^&"\']+)', html)
        clean_urls = [urllib.parse.unquote(u) for u in uddg]
        return clean_urls
    except Exception as e:
        print("Search failed:", e)
        return []

if __name__ == '__main__':
    q = sys.argv[1] if len(sys.argv) > 1 else '"SECTION 26 05 00" filetype:pdf'
    results = search(q)
    print(f"Results for '{q}': {len(results)}")
    for r in results[:10]:
        print(r)
