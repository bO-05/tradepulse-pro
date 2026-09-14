import urllib.request
import urllib.parse
import json

def get_items(q):
    params = urllib.parse.urlencode({
        'q': q,
        'fl': 'identifier,title,mediatype,downloads',
        'sort[]': 'downloads desc',
        'output': 'json',
        'rows': 8
    })
    req = urllib.request.Request(f"https://archive.org/advancedsearch.php?{params}", headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode('utf-8')).get('response', {}).get('docs', [])
    except Exception as e:
        print(f"Error {q}: {e}")
        return []

def get_best_pdf(ident):
    req = urllib.request.Request(f"https://archive.org/metadata/{ident}/files", headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            res = json.loads(r.read().decode('utf-8')).get('result', [])
            pdfs = [
                f for f in res
                if f.get('name', '').lower().endswith('.pdf')
                and not f.get('name', '').endswith('_text.pdf')
                and 50000 < int(f.get('size', 0)) < 15000000
            ]
            if pdfs:
                # pick one
                p = pdfs[0]
                return f"https://archive.org/download/{ident}/{urllib.parse.quote(p['name'])}", int(p['size'])
    except Exception as e:
        pass
    return None, 0

queries = [
    'title:"electrical" AND title:"drawing" AND mediatype:texts',
    'title:"construction" AND title:"drawing" AND mediatype:texts',
    'title:"substation" AND mediatype:texts',
    'title:"contractor" AND title:"proposal" AND mediatype:texts',
    'title:"bid proposal" AND mediatype:texts',
    'title:"subcontract agreement" AND mediatype:texts',
    'title:"commercial" AND title:"bid" AND mediatype:texts',
]

for q in queries:
    print(f"\n--- {q} ---")
    for doc in get_items(q):
        ident = doc['identifier']
        title = doc.get('title', '')
        url, sz = get_best_pdf(ident)
        if url:
            print(f"[{sz/1024:.1f} KB] {ident} | {title}\n  -> {url}")
