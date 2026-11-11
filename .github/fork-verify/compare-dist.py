"""Compare two VitePress builds after normalizing what differs between any two builds:
asset hashes, lastUpdated (git time of the checkout), sitemap lastmod, hashmap.json values,
and line order in llms*.txt. Prints what still differs."""
import os, re, sys

HASHED = re.compile(r'([A-Za-z0-9_.-]+?)\.([A-Za-z0-9_-]{8})\.(lean\.js|js|css)\b')

def norm_path(p):
    return HASHED.sub(r'\1.H.\3', p)

def norm_text(rel, text):
    text = HASHED.sub(r'\1.H.\3', text)
    text = re.sub(r'(lastUpdated\\?"?:)\d+', r'\1N', text)
    text = re.sub(r'<lastmod>[^<]*</lastmod>', '<lastmod>N</lastmod>', text)
    if os.path.basename(rel) == 'hashmap.json':
        text = re.sub(r'":"[A-Za-z0-9_-]{8}"', '":"H"', text)
    if re.match(r'llms.*\.txt$', os.path.basename(rel)):
        text = '\n'.join(sorted(text.splitlines()))
    return text

def load(root):
    out = {}
    for d, _, files in os.walk(root):
        for f in files:
            full = os.path.join(d, f)
            rel = os.path.relpath(full, root)
            data = open(full, 'rb').read()
            try:
                out[norm_path(rel)] = norm_text(rel, data.decode('utf-8'))
            except UnicodeDecodeError:
                out[norm_path(rel)] = data
    return out

a, b = load(sys.argv[1]), load(sys.argv[2])
only_a, only_b = sorted(set(a) - set(b)), sorted(set(b) - set(a))
changed = sorted(k for k in set(a) & set(b) if a[k] != b[k])
print(f'Files: {len(a)} vs {len(b)}; after normalizing: {len(changed)} differ, {len(only_a)} only in the first, {len(only_b)} only in the second')
for k in (changed + only_a + only_b)[:15]:
    print('  ', k)
samples = [k for k in changed if k.endswith('.html')][:2] + [k for k in changed if not k.endswith('.html')][:2]
for k in samples:
    x, y = a[k], b[k]
    if isinstance(x, bytes) or isinstance(y, bytes):
        print(f'-- {k}: binary'); continue
    i = next((n for n in range(min(len(x), len(y))) if x[n] != y[n]), min(len(x), len(y)))
    print(f'-- {k}: first difference at character {i}')
    print('   first:  ', repr(x[max(0, i - 80):i + 80]))
    print('   second: ', repr(y[max(0, i - 80):i + 80]))
