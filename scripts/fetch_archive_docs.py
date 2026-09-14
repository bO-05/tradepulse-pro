import urllib.request
import urllib.parse
import json

def query_archive(query, rows=10):
    params = urllib.parse.urlencode({
        'q': query,
        'fl[]': ['identifier', 'title', 'mediatype'],
        'output': 'json',
        'rows': rows
    })
    url = f"https://archive.org/advancedsearch.php?{params}"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode('utf-8'))
            return data.get('response', {}).get('docs', [])
    except Exception as e:
        print("Error:", e)
        return []

def get_item_files(identifier):
    url = f"https://archive.org/metadata/{identifier}/files"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode('utf-8'))
            return data.get('result', [])
    except Exception as e:
        print(f"Error fetching metadata for {identifier}:", e)
        return []

if __name__ == '__main__':
    queries = [
        'title:"construction specification" AND mediatype:texts',
        'title:"electrical specifications" AND mediatype:texts',
        'title:"mechanical specifications" AND mediatype:texts',
        'title:"plumbing specifications" AND mediatype:texts',
        'title:"ACORD" AND mediatype:texts',
    ]
    for q in queries:
        print(f"\n--- Query: {q} ---")
        docs = query_archive(q, rows=5)
        for d in docs:
            ident = d.get('identifier')
            print(f"ID: {ident} | Title: {d.get('title')}")
            files = get_item_files(ident)
            pdf_files = [f for f in files if f.get('name', '').lower().endswith('.pdf')]
            for pf in pdf_files[:3]:
                print(f"   PDF: https://archive.org/download/{ident}/{pf.get('name')}")
