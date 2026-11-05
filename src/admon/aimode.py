"""Google AI Mode via DataForSEO: fetch, parse and turn into BigQuery rows.

Writes one gzipped JSONL file per run: data/raw/aimode_<YYYY-MM-DD>.jsonl.gz
Each line: {keyword, run_date, fetched_at, cost, queue, task, error}

Usage:
  python -m admon.aimode                    # all keywords from config, Standard Queue
  python -m admon.aimode --limit 3          # smoke test
  python -m admon.aimode --queue live       # Live endpoint (fast, about 3x the price)
Env: DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD
"""
import argparse
import base64
import datetime as dt
import gzip
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

from . import config

API = 'https://api.dataforseo.com'
BASE = '/v3/serp/google/ai_mode'
QUEUE_WAIT = {40601, 40602}  # Task Handed, Task In Queue


class Client:
    def __init__(self, login, password, session=None):
        self.s = session or requests.Session()
        self.s.headers.update({'Authorization': 'Basic ' + base64.b64encode(f'{login}:{password}'.encode()).decode(),
                               'Content-Type': 'application/json'})

    def check_login(self):
        r = self.s.get(API + '/v3/appendix/user_data', timeout=30).json()
        if r.get('status_code') != 20000:
            raise SystemExit(f'DataForSEO login failed: {r.get("status_message")}')

    def live(self, payload, tries=4):
        err = None
        for i in range(tries):
            try:
                t = (self.s.post(API + BASE + '/live/advanced', json=[payload], timeout=150).json().get('tasks') or [{}])[0]
                if t.get('status_code') == 20000 and t.get('result'):
                    return t, None
                err = f"{t.get('status_code')} {t.get('status_message')}"
            except Exception as e:
                err = repr(e)
            time.sleep(3 * (i + 1))
        return None, err


def payload(cfg, kw, tag=None):
    a = cfg['aimode']
    p = {'keyword': kw, 'location_code': a['location_code'], 'language_code': a['language_code'], 'device': a['device']}
    if tag is not None:
        p['tag'] = tag
    return p


def fetch(cli, cfg, keywords, run_date, queue='standard', max_wait_min=45, poll_s=45):
    now = lambda: dt.datetime.now(dt.timezone.utc).isoformat()
    rec = lambda kw, task, err, q: {'keyword': kw, 'run_date': run_date, 'fetched_at': now(), 'cost': (task or {}).get('cost') or 0,
                                    'queue': q, 'task': task, 'error': err}
    results, todo_live = [], []
    if queue == 'standard':
        pending = {}
        try:
            resp = cli.s.post(API + BASE + '/task_post', json=[payload(cfg, k, str(i)) for i, k in enumerate(keywords)], timeout=120).json()
            for t in resp.get('tasks') or []:
                tag = (t.get('data') or {}).get('tag')
                if tag is None:
                    continue
                kw = keywords[int(tag)]
                (pending.__setitem__(t['id'], kw) if t.get('status_code') == 20100 else todo_live.append(kw))
        except Exception as e:
            print(f'task_post failed ({e!r}); everything via Live', flush=True)
            todo_live = list(keywords)
        posted = set(pending.values()) | set(todo_live)
        todo_live += [k for k in keywords if k not in posted]
        print(f'Standard queue: {len(pending)} tasks posted, {len(todo_live)} via Live', flush=True)

        def get(tid):
            try:
                t = (cli.s.get(f'{API}{BASE}/task_get/advanced/{tid}', timeout=60).json().get('tasks') or [{}])[0]
            except Exception as e:
                return tid, 'wait', repr(e)
            if t.get('status_code') == 20000 and t.get('result'):
                return tid, 'ok', t
            if t.get('status_code') in QUEUE_WAIT or t.get('status_code') is None:
                return tid, 'wait', None
            return tid, 'fail', f"{t.get('status_code')} {t.get('status_message')}"

        deadline = time.time() + max_wait_min * 60
        while pending and time.time() < deadline:
            time.sleep(poll_s)
            with ThreadPoolExecutor(8) as ex:
                for tid, state, val in ex.map(get, list(pending)):
                    if state == 'wait':
                        continue
                    kw = pending.pop(tid)
                    (results.append(rec(kw, val, None, 'standard')) if state == 'ok' else todo_live.append(kw))
            print(f'  queue: {len(results)} done, {len(pending)} waiting', flush=True)
        todo_live += list(pending.values())
    else:
        todo_live = list(keywords)
    for kw in todo_live:
        t, err = cli.live(payload(cfg, kw))
        results.append(rec(kw, t, err, 'live'))
    # second pass for transient failures
    for i, r in enumerate(results):
        if r['error']:
            time.sleep(2)
            t, err = cli.live(payload(cfg, r['keyword']), tries=3)
            results[i] = rec(r['keyword'], t, err, 'live')
    return results


# ---------------------------------------------------------------- parsing
def _walk(o):
    if isinstance(o, dict):
        yield o
        for v in o.values():
            yield from _walk(v)
    elif isinstance(o, list):
        for v in o:
            yield from _walk(v)


def parse(task, cfg):
    """-> dict with mentioned, cited, own_url, mention_text, ref_domains, markdown, check_url."""
    own = cfg['client']['domain']
    mre = re.compile(cfg['client']['mention_pattern'], re.I)
    res = (task.get('result') or [{}])[0]
    md_parts, refs, own_url = [], [], None
    for item in res.get('items') or []:
        if item.get('markdown'):
            md_parts.append(item['markdown'])
    for o in _walk(res.get('items') or []):
        if o.get('type') == 'ai_overview_reference' or (o.get('type') == 'link_element' and o.get('domain')):
            d = (o.get('domain') or '').lower().removeprefix('www.')
            if d and d not in refs:
                refs.append(d)
            if d.endswith(own) and not own_url:
                own_url = o.get('url')
    md = '\n'.join(md_parts)
    text = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', md)
    mention = None
    for sent in re.split(r'(?<=[.!?])\s+|\n+', text):
        if mre.search(sent):
            mention = re.sub(r'[*#>|]', '', sent).strip()[:300]
            break
    return {'mentioned': bool(mention), 'cited': own_url is not None or any(d.endswith(own) for d in refs), 'own_url': own_url,
            'mention_text': mention, 'ref_domains': refs[:30], 'markdown': md[:20000], 'check_url': res.get('check_url')}


def transform_files(paths, cfg=None):
    """Raw JSONL files -> {table: rows} for bq.load_tables."""
    cfg = cfg or config.load()
    T = {'aimode_results': [], 'raw_tasks': [], 'run_log': []}
    for p in paths:
        with gzip.open(p, 'rt', encoding='utf-8') as fh:
            for line in fh:
                r = json.loads(line)
                base = {'run_date': r['run_date'], 'keyword': r['keyword']}
                T['run_log'].append(dict(base, engine='google_ai_mode', status='error' if r['error'] else 'ok', error=r['error'],
                                         cost=r.get('cost') or 0, queue=r.get('queue'), fetched_at=r['fetched_at']))
                if r['error'] or not r['task']:
                    continue
                T['aimode_results'].append(dict(base, status='ok', fetched_at=r['fetched_at'], **parse(r['task'], cfg)))
                T['raw_tasks'].append(dict(base, engine='google_ai_mode', fetched_at=r['fetched_at'], task=json.dumps(r['task'], ensure_ascii=False)))
    return T


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--date', default=dt.datetime.now(dt.timezone.utc).date().isoformat())
    ap.add_argument('--out', default=None)
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--max-error-rate', type=float, default=0.10)
    ap.add_argument('--queue', choices=['standard', 'live'], default=None)
    a = ap.parse_args(argv)
    cfg = config.load()
    cli = Client(config.env('DATAFORSEO_LOGIN', required=True), config.env('DATAFORSEO_PASSWORD', required=True))
    cli.check_login()  # the balance is not printed (public logs)
    kws = cfg['aimode']['keywords'][:a.limit or None]
    print(f'{len(kws)} AI Mode keywords for run {a.date}', flush=True)
    results = fetch(cli, cfg, kws, a.date, a.queue or cfg['aimode'].get('queue', 'standard'))
    errors = [r for r in results if r['error']]
    out = Path(a.out or config.ROOT / 'data' / 'raw' / f'aimode_{a.date}.jsonl.gz')
    out.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(out, 'wt', encoding='utf-8') as fh:
        for r in results:
            fh.write(json.dumps(r, ensure_ascii=False) + '\n')
    print(f'Wrote {out.name} | ok {len(results) - len(errors)} | errors {len(errors)} | cost ${sum(r["cost"] for r in results):.3f}')
    if len(errors) > a.max_error_rate * max(len(results), 1):
        sys.exit(f'Error rate too high ({len(errors)}/{len(results)}); not loading this run')


if __name__ == '__main__':
    main()
