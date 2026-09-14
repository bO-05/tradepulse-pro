import re
import glob
import subprocess

urls = set()
for ext in ['ts', 'tsx', 'js', 'mjs', 'py', 'json', 'md']:
    for f in glob.glob('**/*.' + ext, recursive=True):
        if any(x in f for x in ['node_modules', '.git', 'dist']):
            continue
        try:
            with open(f, 'r', encoding='utf-8', errors='ignore') as fp:
                txt = fp.read()
                found = re.findall(r'https?://[a-zA-Z0-9.-]+(?:\/[^\s\'\"`<>)]*)?', txt)
                for u in found:
                    # Clean trailing punctuation
                    cleaned = re.sub(r'[,;.:]+$', '', u)
                    urls.add((cleaned, f))
        except Exception as e:
            pass

print(f"Total unique URLs found: {len(urls)}")
by_url = {}
for u, f in urls:
    if u not in by_url:
        by_url[u] = []
    by_url[u].append(f)

for u in sorted(by_url.keys()):
    print(f"{u} (in {len(by_url[u])} files: {by_url[u][:2]})")
