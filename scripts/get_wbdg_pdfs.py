import urllib.request
import json

def find_pdf_specs():
    # Let's search documents
    for page in range(1, 10):
        url = f"https://www.wbdg.org/api/documents?limit=50&page={page}"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                res = json.loads(r.read().decode('utf-8'))
                docs = res.get('data', [])
                if not docs:
                    break
                for d in docs:
                    title = d.get('title', '')
                    media = d.get('mediaFiles', [])
                    for m in media:
                        fn = m.get('fileName', '')
                        if fn.lower().endswith('.pdf'):
                            url_alias = d.get('urlAlias', '')
                            # Media file download url
                            # Let's see what m has
                            print(f"TITLE: {title} | FILE: {fn} | URL: {m.get('url')} | PATH: {m.get('filePath')}")
        except Exception as e:
            print("Error on page", page, e)
            break

find_pdf_specs()
