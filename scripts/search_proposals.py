import urllib.request
import urllib.parse
import json

def search(q, n=6):
    params = urllib.parse.urlencode({'q': q, 'fl': 'identifier,title,description', 'output': 'json', 'rows': n})
    req = urllib.request.Request('https://archive.org/advancedsearch.php?' + params, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode('utf-8')).get('response', {}).get('docs', [])
    except Exception as e:
        print(e)
        return []

def get_pdfs(ident):
    req = urllib.request.Request(f'https://archive.org/metadata/{ident}/files', headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            files = json.loads(r.read().decode('utf-8')).get('result', [])
            return [
                f for f in files
                if f.get('name', '').lower().endswith('.pdf')
                and not f.get('name', '').endswith('_text.pdf')
                and 20000 < int(f.get('size', 0)) < 10000000
            ]
    except:
        return []

queries = [
    'title:"Subcontractor Bid" OR title:"Subcontract Agreement" mediatype:texts',
    'title:"Bid Proposal" AND ("electrical" OR "mechanical" OR "construction") mediatype:texts',
    'title:"Contractor Proposal" mediatype:texts',
    'title:"Subcontractor Proposal" mediatype:texts',
    'title:"A401" OR title:"Standard Form of Agreement Between Contractor" mediatype:texts',
]

for q in queries:
    print(f"\n=== {q} ===")
    for doc in search(q):
        ident = doc['identifier']
        title = doc.get('title')
        pdfs = get_pdfs(ident)
        for p in pdfs[:1]:
            sz = int(p.get('size', 0)) / 1024
            name = urllib.parse.quote(p.get('name'))
            print(f"[{sz:.1f} KB] {ident} | {title}\n  -> https://archive.org/download/{ident}/{name}")
