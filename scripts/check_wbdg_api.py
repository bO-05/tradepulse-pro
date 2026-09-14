import urllib.request
import re

req = urllib.request.Request('https://www.wbdg.org/ffc/dod/unified-facilities-guide-specifications-ufgs', headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req) as r:
    html = r.read().decode('utf-8', errors='ignore')

scripts = re.findall(r'src="([^"]+\.js)"', html)
print('Scripts:', scripts)
if scripts:
    s_url = 'https://www.wbdg.org' + scripts[0]
    req2 = urllib.request.Request(s_url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req2) as r2:
        js = r2.read().decode('utf-8', errors='ignore')
        api_endpoints = re.findall(r'"/api/[^"]+"', js)
        print('API endpoints in JS:', set(api_endpoints[:25]))
