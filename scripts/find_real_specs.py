import urllib.request
import re

u = 'https://www.wbdg.org/ffc/va/specifications-masterformat'
req = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
try:
    with urllib.request.urlopen(req, timeout=10) as r:
        html = r.read().decode('utf-8', errors='ignore')
    links = re.findall(r'href=[\'"]([^\'"]+)[\'"]', html)
    print("Found total links:", len(links))
    div_links = [l for l in links if any(k in l.lower() for k in ['division', '26', '23', '22', '01'])]
    for l in sorted(set(div_links))[:40]:
        print("MATCH:", l)
except Exception as e:
    print("Error:", e)
