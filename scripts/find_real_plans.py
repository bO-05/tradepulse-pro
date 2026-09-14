import urllib.request, json, urllib.parse

def search(q, limit=5):
    p = urllib.parse.urlencode({'q': q, 'fl': 'identifier,title', 'output': 'json', 'rows': 15})
    req = urllib.request.Request('https://archive.org/advancedsearch.php?' + p, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        r = json.loads(urllib.request.urlopen(req, timeout=10).read())
        count = 0
        for d in r.get('response', {}).get('docs', []):
            if count >= limit: break
            ident = d['identifier']
            title = d.get('title', '')
            req2 = urllib.request.Request(f'https://archive.org/metadata/{ident}/files', headers={'User-Agent': 'Mozilla/5.0'})
            try:
                meta = json.loads(urllib.request.urlopen(req2, timeout=8).read())
                pdfs = [
                    f for f in meta.get('result', [])
                    if f.get('name', '').lower().endswith('.pdf')
                    and f.get('size') and 50000 < int(f.get('size', 0)) < 6000000
                    and not f.get('name', '').endswith('_text.pdf')
                ]
                if pdfs:
                    pdf = pdfs[0]
                    sz = int(pdf['size']) / 1024
                    url = f"https://archive.org/download/{ident}/{urllib.parse.quote(pdf['name'])}"
                    print(f"[{sz:.1f} KB] {ident} | {title} | {url}")
                    count += 1
            except Exception as e:
                pass
    except Exception as e:
        print("Error:", e)

if __name__ == '__main__':
    print("=== DRAWINGS & PLANS ===")
    search('mediatype:texts AND ("construction drawing" OR "electrical plan" OR "floor plan" OR "mechanical plan")', 4)
    print("\n=== AIA / SUBCONTRACT AGREEMENTS ===")
    search('mediatype:texts AND ("subcontract agreement" OR "A401" OR "subcontractor contract")', 4)
    print("\n=== CONTRACTOR BID PROPOSALS ===")
    search('mediatype:texts AND ("bid proposal" OR "contractor proposal" OR "subcontractor proposal") AND ("electrical" OR "mechanical" OR "plumbing" OR "commercial")', 4)
