import urllib.request
import urllib.parse
import json

def search(q, n=5):
    params = urllib.parse.urlencode({'q': q, 'fl': 'identifier,title,mediatype', 'output': 'json', 'rows': n})
    req = urllib.request.Request('https://archive.org/advancedsearch.php?' + params, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode('utf-8'))
            return data.get('response', {}).get('docs', [])
    except Exception as e:
        print(f"Error searching for {q}: {e}")
        return []

def get_pdf_files(ident):
    req = urllib.request.Request(f'https://archive.org/metadata/{ident}/files', headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            meta = json.loads(r.read().decode('utf-8'))
            files = meta.get('result', [])
            pdfs = [
                f for f in files
                if f.get('name', '').lower().endswith('.pdf')
                and not f.get('name', '').endswith('_text.pdf')
                and 10000 < int(f.get('size', 0)) < 15000000
            ]
            return pdfs
    except Exception as e:
        return []

def main():
    queries = [
        '("construction drawings" OR "architectural drawings" OR "electrical plan" OR "floor plan") AND mediatype:texts',
        '("switchgear" OR "substation" OR "switchboard") AND ("drawings" OR "diagram" OR "specifications") AND mediatype:texts',
        '("bid proposal" OR "contractor proposal" OR "subcontractor bid" OR "subcontract agreement") AND mediatype:texts',
        '("construction contract" OR "AIA Document" OR "invitation for bids") AND mediatype:texts',
    ]
    for q in queries:
        print(f"\n=== Query: {q} ===")
        docs = search(q, n=4)
        for d in docs:
            ident = d['identifier']
            title = d.get('title')
            pdfs = get_pdf_files(ident)
            print(f"ID: {ident} | Title: {title} | {len(pdfs)} PDFs")
            for p in pdfs[:2]:
                sz_kb = int(p.get('size', 0)) / 1024
                url = f"https://archive.org/download/{ident}/{urllib.parse.quote(p['name'])}"
                print(f"   [{sz_kb:.1f} KB] {url}")

if __name__ == '__main__':
    main()
