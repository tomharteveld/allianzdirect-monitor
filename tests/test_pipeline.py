"""Offline tests: no network, no Google credentials. Run with: PYTHONPATH=src pytest -q"""
import gzip
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
sys.path.insert(0, str(ROOT / 'tests'))

import synthetic  # noqa: E402
from admon import aimode, annotations, bq, build, config, dashboard, sources  # noqa: E402


# ---------------------------------------------------------------- config and clusters
def test_cluster_rules_python_and_sql_agree():
    assert config.classify('keyword', 'reisverzekering') == 'reisverzekering'
    assert config.classify('keyword', 'inboedelverzekering') == 'woonverzekering'
    assert config.classify('keyword', 'autoschade melden') == 'autoschade'
    assert config.classify('keyword', 'allianz direct inloggen') == 'merk'
    assert config.classify('keyword', 'auto verzekeren') == 'autoverzekering'
    assert config.classify('url', 'https://www.allianzdirect.nl/woonverzekering/') == 'woonverzekering'
    sql = config.cluster_sql('keyword', 'keyword')
    for cl, pat in config.load()['clusters']['keyword_rules']:
        assert f"r'{pat}') THEN '{cl}'" in sql
        assert "'" not in pat, 'single quotes would break the SQL literal'


def test_queries_have_the_columns_build_expects():
    q = sources.queries()
    S = synthetic.sources()
    assert set(q) == set(S)
    for name, sql in q.items():
        assert '@start' in sql or name in ('llm_brand', 'llm_cite', 'llm_answers'), name
        for col in S[name][0]:
            assert re.search(rf'\b{col}\b', sql), f'{name}: column {col} missing in SQL'


# ---------------------------------------------------------------- build
def test_build_payload_shapes():
    D = build.build_data(synthetic.sources(), synthetic.own(), annotations=synthetic.google_status(), today=synthetic.TODAY)
    n = len(D['fe_dates'])
    assert n == 30 and len(D['fe_trend']) == n and len(D['fe_dist']) == n
    assert set(D['fe_cl']) == {'alle'} | {c for c, _ in config.cluster_labels()}
    for v in D['fe_cl'].values():
        assert len(v['share']) == n
    assert D['fe_trend'][-1][1] == D['fe_cl']['alle']['share'][-1]
    w = len(D['gsc_weekly'])
    assert w == 39, 'the incomplete last GSC week must be dropped'
    for v in D['gsc_cl'].values():
        assert len(v['url_pos']) == len(v['q_pos']) == w
    assert all(not v['brand'] or v['cl'] == 'merk' for v in D['gsc_query_hist'].values())
    assert len(D['aio_hist_dates']) == 20 and all(len(v['v']) == 20 for v in D['aio_kw_hist'].values())
    assert any(r[6] for r in D['aio_trend']), 'incomplete AIO measurement should be flagged'
    assert len(D['gpt_hist']['dates']) == 15 and D['gpt_trend'][-1][1] == len(synthetic.PROMPTS)
    assert D['aimode']['runs'] == 2 and D['aimode']['total_planned'] == 40
    assert all(len(h['dates']) == 2 for h in D['aimode_hist'].values())
    assert D['data_through']['gsc'] == '2026-11-01'
    assert [a['date'] for a in D['annotations']] == sorted(a['date'] for a in D['annotations'])


def test_auto_doubts():
    D = build.build_data(synthetic.sources(), synthetic.own(), today=synthetic.TODAY)
    cfg = dict(config.load())
    cfg['dashboard'] = dict(cfg['dashboard'], auto_doubts_from='2025-01-01')
    flags = annotations.auto_doubts(D, cfg, '2027-01-01')
    titles = ' '.join(a['title'] for a in flags)
    assert 'AIO-meting onvolledig' in titles
    assert 'laatste data van' in titles   # everything is stale in 2027


def test_annotation_merge_dedupes_and_own_wins():
    own = [{'date': '2026-09-24', 'type': 'google', 'title': 'Voorbeeld spam update', 'detail': 'eigen toelichting', 'source': 'Google Search Status',
            'url': '', 'tabs': ['all']}]
    out = annotations.merge(own, synthetic.google_status(), [])
    assert len(out) == 1 and out[0]['detail'] == 'eigen toelichting'


def test_google_status_parser():
    class R:
        def json(self):
            return [{'begin': '2026-09-24T16:15:00+00:00', 'end': '2026-10-01T10:00:00+00:00', 'external_desc': 'September 2026 spam update',
                     'affected_products': [{'title': 'Ranking', 'id': 'x'}], 'uri': 'incidents/abc'},
                    {'begin': '2026-09-20T10:00:00+00:00', 'external_desc': 'Crawling issue', 'affected_products': [{'title': 'Crawling'}]}]

    class Sess:
        def get(self, *a, **k):
            return R()
    out = annotations.google_status(Sess())
    assert len(out) == 1 and out[0]['date'] == '2026-09-24' and 'uitrol klaar op 2026-10-01' in out[0]['detail']


# ---------------------------------------------------------------- AI Mode
TASK = {'status_code': 20000, 'cost': 0.0012, 'result': [{'check_url': 'https://www.google.com/search?q=x&udm=50', 'items': [
    {'type': 'ai_overview', 'markdown': 'Vergelijk aanbieders. **Allianz Direct** heeft scherpe premies voor WA. [bron](https://x.nl)',
     'items': [{'type': 'ai_overview_element', 'references': [
         {'type': 'ai_overview_reference', 'domain': 'www.allianzdirect.nl', 'url': 'https://www.allianzdirect.nl/autoverzekering/'},
         {'type': 'ai_overview_reference', 'domain': 'vergelijker-een.nl', 'url': 'https://vergelijker-een.nl/'}]}]}]}]}


def test_aimode_parse():
    p = aimode.parse(TASK, config.load())
    assert p['cited'] and p['mentioned'] and p['own_url'].endswith('/autoverzekering/')
    assert p['ref_domains'] == ['allianzdirect.nl', 'vergelijker-een.nl']
    assert 'Allianz Direct heeft scherpe premies' in p['mention_text']


class FakeResp:
    def __init__(self, data):
        self.data = data

    def json(self):
        return self.data


class FakeDFS:
    """Standard queue: two tasks queued, one rejected at post (goes Live); first poll still waiting."""
    def __init__(self):
        self.headers = {}
        self.polls = {}

    def post(self, url, json=None, timeout=None):
        if url.endswith('/task_post'):
            tasks = []
            for t in json:
                ok = t['tag'] != '2'
                tasks.append({'id': f"id{t['tag']}", 'status_code': 20100 if ok else 40501, 'data': {'tag': t['tag']}})
            return FakeResp({'tasks': tasks})
        if url.endswith('/live/advanced'):
            return FakeResp({'tasks': [TASK]})
        raise AssertionError(url)

    def get(self, url, timeout=None):
        tid = url.rsplit('/', 1)[1]
        self.polls[tid] = self.polls.get(tid, 0) + 1
        if self.polls[tid] == 1:
            return FakeResp({'tasks': [{'status_code': 40602}]})
        return FakeResp({'tasks': [TASK]})


def test_aimode_fetch_queue_and_live(tmp_path, monkeypatch):
    monkeypatch.setattr(aimode.time, 'sleep', lambda s: None)
    cli = aimode.Client('l', 'p', session=FakeDFS())
    res = aimode.fetch(cli, config.load(), ['a', 'b', 'c'], '2026-11-16', 'standard', poll_s=0)
    assert sorted(r['keyword'] for r in res) == ['a', 'b', 'c']
    assert {r['queue'] for r in res} == {'standard', 'live'} and not any(r['error'] for r in res)
    f = tmp_path / 'aimode_2026-11-16.jsonl.gz'
    with gzip.open(f, 'wt') as fh:
        for r in res + [{'keyword': 'd', 'run_date': '2026-11-16', 'fetched_at': 'x', 'cost': 0, 'queue': 'live', 'task': None, 'error': '500 x'}]:
            fh.write(json.dumps(r) + '\n')
    T = aimode.transform_files([f])
    assert len(T['aimode_results']) == 3 and len(T['run_log']) == 4 and len(T['raw_tasks']) == 3
    for name, rows in T.items():
        allowed = {s.name for s in bq.SCHEMAS[name]}
        for r in rows:
            assert set(r) <= allowed, (name, set(r) - allowed)
            if name == 'aimode_results':
                assert isinstance(r['ref_domains'], list)
            if name == 'raw_tasks':
                json.loads(r['task'])


# ---------------------------------------------------------------- BigQuery loads (fake client)
class FakeJob:
    def result(self):
        return []


class FakeBQ:
    def __init__(self):
        self.loads, self.queries = [], []

    def load_table_from_json(self, rows, dest, job_config=None):
        self.loads.append((dest, len(rows), job_config))
        return FakeJob()

    def query(self, sql, **k):
        self.queries.append(sql)
        return FakeJob()


def test_load_tables_partition_decorator_and_truncate(monkeypatch):
    monkeypatch.setenv('GCP_PROJECT_ID', 'proj')
    c = FakeBQ()
    T = {'aimode_results': [{'run_date': '2026-11-16', 'keyword': 'a', 'ref_domains': []}], 'run_log': []}
    bq.load_tables(T, c)
    dest, n, cfg = c.loads[0]
    assert dest.endswith('.aimode_results$20261116') and n == 1
    assert cfg.write_disposition == 'WRITE_TRUNCATE'
    assert cfg.time_partitioning is None and cfg.clustering_fields is None
    assert any('DELETE FROM' in q and 'run_log' in q for q in c.queries)


# ---------------------------------------------------------------- render
def test_render_page(tmp_path):
    D = build.build_data(synthetic.sources(), synthetic.own(), annotations=synthetic.google_status(), today=synthetic.TODAY)
    dashboard.render(D, tmp_path, 'geheim')
    html = (tmp_path / 'geheim' / 'index.html').read_text()
    assert html.startswith('<!doctype html>') and 'noindex' in html and 'no-referrer' in html
    assert '__DATA__' not in html and '__APP__' not in html
    data = html.split('<script type="application/json" id="data">', 1)[1].split('</script>', 1)[0]
    assert json.loads(data.replace('<\\/', '</'))['domain'] == 'allianzdirect.nl'
    root = (tmp_path / 'index.html').read_text()
    assert 'allianz' not in root.lower() and 'geheim' not in root
    assert (tmp_path / 'robots.txt').read_text().strip().endswith('Disallow: /')
