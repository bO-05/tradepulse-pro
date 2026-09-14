import urllib.request

specs = {
    'general_req': 'https://www.wbdg.org/FFC/DOD/UFC/ufc_1_300_02_2014.pdf',
    'general_bldg': 'https://www.wbdg.org/FFC/DOD/UFC/ufc_1_200_01_2022.pdf',
    'electrical_interior': 'https://www.wbdg.org/FFC/DOD/UFC/ufc_3_520_01_2020.pdf',
    'electrical_safety': 'https://www.wbdg.org/FFC/DOD/UFC/ufc_3_560_01_2017.pdf',
    'hvac_systems': 'https://www.wbdg.org/FFC/DOD/UFC/ufc_3_410_01_2020.pdf',
    'hvac_controls': 'https://www.wbdg.org/FFC/DOD/UFC/ufc_3_410_02_2018.pdf',
    'plumbing_systems': 'https://www.wbdg.org/FFC/DOD/UFC/ufc_3_420_01_2020.pdf',
    'water_systems': 'https://www.wbdg.org/FFC/DOD/UFC/ufc_3_230_02_2019.pdf',
}

for name, url in specs.items():
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            length = r.headers.get('Content-Length')
            ctype = r.headers.get('Content-Type')
            print(f"{name}: {r.status} {ctype} ({length} bytes)")
    except Exception as e:
        print(f"{name}: FAILED - {e}")
