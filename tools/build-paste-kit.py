"""Bundle src/ into paste-kit/: one Code.gs + 4 self-contained HTML pages + manifest."""
import os, re, glob
src, out = 'src', 'paste-kit'
os.makedirs(out, exist_ok=True)
order = ['Config','Util','Db','Auth','Drive','Notifications','Setup','Requirements','Tasks','Uploads','Approvals','Review','Admin','Reports','Code']
assert set(order) == {os.path.basename(p)[:-3] for p in glob.glob(src + '/*.gs')}, 'update the order list'
with open(f'{out}/Code.gs', 'w', encoding='utf-8') as f:
    for n in order:
        f.write(f"\n/* ======================= {n}.gs ======================= */\n" + open(f'{src}/{n}.gs', encoding='utf-8').read())
inc = re.compile(r"<\?!=\s*include_\('([^']+)'\)\s*\?>")
for p in ['Form', 'Review', 'App', 'NoAccess']:
    html = inc.sub(lambda m: open(f"{src}/{m.group(1)}.html", encoding='utf-8').read(), open(f'{src}/{p}.html', encoding='utf-8').read())
    open(f'{out}/{p}.html', 'w', encoding='utf-8').write(html)
open(f'{out}/appsscript.json', 'w').write(open(f'{src}/appsscript.json').read())
print('paste-kit built')
