"""Build the dashboard: one self-contained HTML page under site/<SECRET_PATH>/index.html.

Usage:
  python -m admon.dashboard --source bq --out site                 # from BigQuery (CI)
  python -m admon.dashboard --source fixture --out site --path x   # from tests/fixtures (offline)
Env: DASHBOARD_PATH (secret sub path), GCP_PROJECT_ID, BQ_DATASET, BQ_LOCATION
"""
import argparse
import datetime as dt
import json
from pathlib import Path

from . import annotations, build, config

TEMPLATE = config.ROOT / 'dashboard' / 'template.html'
APP = config.ROOT / 'dashboard' / 'app.js'

HEAD = """<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<style>html,body{margin:0;padding:0}[hidden]{display:none!important}</style>
"""
EMPTY = '<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>.</title></head><body></body></html>\n'


def render(D, out, secret_path):
    tpl = TEMPLATE.read_text(encoding='utf-8')
    cut = tpl.index('<div class="app">')
    head, body = tpl[:cut], tpl[cut:]
    payload = json.dumps(D, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    body = body.replace('__DATA__', payload).replace('__APP__', APP.read_text(encoding='utf-8').replace('</script', '<\\/script'))
    html = HEAD + head + '</head>\n<body>\n' + body + '</body>\n</html>\n'
    out = Path(out)
    page = out / secret_path / 'index.html'
    page.parent.mkdir(parents=True, exist_ok=True)
    page.write_text(html, encoding='utf-8')
    (out / 'index.html').write_text(EMPTY, encoding='utf-8')
    (out / '404.html').write_text(EMPTY, encoding='utf-8')
    (out / 'robots.txt').write_text('User-agent: *\nDisallow: /\n', encoding='utf-8')
    (out / '.nojekyll').write_text('', encoding='utf-8')
    kb = len(html.encode()) // 1024
    print(f'Dashboard written ({kb} KB)')
    return kb


def from_bq(mode):
    from . import bq, sources
    c = bq.client()
    bq.setup(c)
    S = sources.fetch(c)
    own = bq.fetch_own(c)
    D = build.build_data(S, own, annotations=annotations.google_status())
    return D, (lambda kb: bq.log_build(D, kb, mode, c))


def from_fixture():
    sys_path = config.ROOT / 'tests'
    import sys
    sys.path.insert(0, str(sys_path))
    import synthetic
    S, own = synthetic.sources(), synthetic.own()
    return build.build_data(S, own, annotations=synthetic.google_status(), today=synthetic.TODAY), None


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', choices=['bq', 'fixture'], default='bq')
    ap.add_argument('--out', default='site')
    ap.add_argument('--path', default=None, help='secret sub path (default: env DASHBOARD_PATH)')
    ap.add_argument('--mode', default='full')
    a = ap.parse_args(argv)
    path = a.path or config.env('DASHBOARD_PATH', required=True)
    D, log = from_bq(a.mode) if a.source == 'bq' else from_fixture()
    kb = render(D, a.out, path)
    if log:
        log(kb)
    t = D['data_through']
    print(f"Data t/m: Google {t['google']} · AIO {t['aio']} · ChatGPT {t['chatgpt']} · GSC {t['gsc']} · AI Mode {t['aimode']} "
          f"· {len(D['annotations'])} annotaties · gebouwd {dt.date.today().isoformat()}")


if __name__ == '__main__':
    main()
