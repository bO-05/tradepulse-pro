import urllib.request
import urllib.parse

candidates = [
    "UFGS 26 20 00.pdf",
    "UFGS 26 24 13.pdf",
    "UFGS 26 05 19.pdf",
    "UFGS 26 00 00 00 20.pdf",
    "UFGS 26 05 00.pdf",
    "UFGS 26 05 48.00 40.pdf",
    "UFGS 22 00 00.pdf",
    "UFGS 22 11 00.pdf",
    "UFGS 01 33 00.pdf",
    "UFGS 01 30 00.pdf",
    "UFGS 01 00 00.pdf",
]

for c in candidates:
    enc = urllib.parse.quote(c)
    url = f"https://www.wbdg.org/FFC/DOD/UFGS/{enc}"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            final_url = r.geturl()
            print(f"FOUND: {c} -> {final_url} ({r.headers.get('Content-Length')} bytes)")
    except Exception as e:
        # pass
        pass
