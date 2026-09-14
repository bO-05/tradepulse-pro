import urllib.request
import re

url = 'https://www.wbdg.org/ffc/va/specifications-masterformat-2004'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
try:
    with urllib.request.urlopen(req, timeout=10) as resp:
        html = resp.read().decode('utf-8', errors='ignore')
        links = re.findall(r'href=["\']([^"\']+)["\']', html)
        print("Total links:", len(links))
        spec_links = [l for l in links if 'spec' in l.lower() or '26' in l or '23' in l or '22' in l or '01' in l]
        print("Spec-related links:", len(spec_links))
        for l in spec_links[:20]:
            print(l)
except Exception as e:
    print("Error:", e)
