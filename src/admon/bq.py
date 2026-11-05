"""BigQuery: the monitor's own dataset (AI Mode runs, raw responses, run and build logs, annotations).

The FolloEngine and Search Console data are read in place from their source tables (sources.py);
this dataset only holds what the monitor adds itself.

Usage:
  python -m admon.bq setup                                       # create dataset + tables
  python -m admon.bq load data/raw/aimode_2026-11-16.jsonl.gz    # transform + load (replaces that run_date)
Env: GCP_PROJECT_ID, BQ_DATASET (default allianzdirect_monitor), BQ_LOCATION (default EU)
"""
import argparse
import datetime as dt
import json

from google.cloud import bigquery as bq

from . import config

F = bq.SchemaField
S, I, B, FL, D, TS = 'STRING', 'INTEGER', 'BOOLEAN', 'FLOAT', 'DATE', 'TIMESTAMP'
KEY = [F('run_date', D, 'REQUIRED'), F('keyword', S)]

SCHEMAS = {
    'aimode_results': KEY + [F('status', S), F('fetched_at', TS), F('mentioned', B), F('cited', B), F('own_url', S),
                             F('mention_text', S), F('ref_domains', S, 'REPEATED'), F('markdown', S), F('check_url', S)],
    'raw_tasks': KEY + [F('engine', S), F('fetched_at', TS), F('task', 'JSON')],
    'run_log': KEY + [F('engine', S), F('status', S), F('error', S), F('cost', FL), F('queue', S), F('fetched_at', TS)],
    'build_log': [F('run_date', D, 'REQUIRED'), F('built_at', TS), F('google', D), F('aio', D), F('chatgpt', D), F('gsc', D),
                  F('aimode', D), F('annotations', I), F('payload_kb', I), F('mode', S)],
    # not partitioned: a small, hand-maintained table (monthly Claude task or manual inserts)
    'annotations': [F('date', D, 'REQUIRED'), F('type', S, 'REQUIRED'), F('title', S, 'REQUIRED'), F('detail', S), F('source', S),
                    F('url', S), F('tabs', S, 'REPEATED'), F('added_at', TS), F('added_by', S)],
}
CLUSTER = {'aimode_results': ['keyword'], 'raw_tasks': ['keyword'], 'run_log': ['engine'], 'build_log': None, 'annotations': ['type']}
UNPARTITIONED = {'annotations'}


def client():
    return bq.Client(project=config.BQ_PROJECT(), location=config.BQ_LOCATION())


def tid(name):
    return f'{config.BQ_PROJECT()}.{config.BQ_DATASET()}.{name}'


def setup(c=None):
    c = c or client()
    from google.api_core.exceptions import NotFound
    ds_id = f'{config.BQ_PROJECT()}.{config.BQ_DATASET()}'
    try:  # check first: the service account may edit the dataset but not create datasets in the project
        c.get_dataset(ds_id)
    except NotFound:
        ds = bq.Dataset(ds_id)
        ds.location = config.BQ_LOCATION()
        c.create_dataset(ds)
    for name, schema in SCHEMAS.items():
        try:
            c.get_table(tid(name))
            continue
        except NotFound:
            pass
        t = bq.Table(tid(name), schema=schema)
        if name not in UNPARTITIONED:
            t.time_partitioning = bq.TimePartitioning(type_=bq.TimePartitioningType.DAY, field='run_date')
        if CLUSTER.get(name):
            t.clustering_fields = CLUSTER[name]
        c.create_table(t)
    print(f'Dataset {config.BQ_DATASET()} ready ({len(SCHEMAS)} tables)')


def _jsonable(rows):
    for r in rows:
        yield {k: (v.isoformat() if isinstance(v, (dt.date, dt.datetime)) else v) for k, v in r.items()}


def load_tables(T, c=None):
    """Replace the run_date partition(s) of every table with the given rows (re-running a date is safe)."""
    c = c or client()
    dates = sorted({r['run_date'] for rows in T.values() for r in rows if r.get('run_date')})
    for name, rows in T.items():
        for d in dates:
            part = [r for r in rows if r['run_date'] == d]
            if name == 'raw_tasks':
                part = [dict(r, task=json.loads(r['task'])) for r in part]  # JSON column takes the object itself
            # no partitioning/clustering here: the table already defines them and BigQuery rejects a mismatch
            job_cfg = bq.LoadJobConfig(schema=SCHEMAS[name], write_disposition='WRITE_TRUNCATE',
                                       source_format=bq.SourceFormat.NEWLINE_DELIMITED_JSON)
            dest = f"{tid(name)}${d.replace('-', '')}"
            if not part:  # still clear the partition so a re-run without data does not leave stale rows
                c.query(f"DELETE FROM `{tid(name)}` WHERE run_date = '{d}'").result()
                continue
            c.load_table_from_json(list(_jsonable(part)), dest, job_config=job_cfg).result()
            print(f'  {name:15s} {d}  {len(part):6d} rows')


def fetch_own(c=None):
    """What the dashboard needs from the monitor's own tables."""
    c = c or client()
    q = lambda sql: [dict(r) for r in c.query(sql).result()]
    out = {'aimode_results': q(f"SELECT * EXCEPT(markdown) FROM `{tid('aimode_results')}`"),
           'annotations': q(f"SELECT * EXCEPT(added_at, added_by) FROM `{tid('annotations')}` ORDER BY date")}
    for rows in out.values():
        for r in rows:
            for k, v in list(r.items()):
                if hasattr(v, 'isoformat'):
                    r[k] = v.isoformat()
            if 'run_date' in r:
                r['run_date'] = r['run_date'][:10]
    return out


def log_build(D, kb, mode, c=None):
    c = c or client()
    t = D['data_through']
    row = {'run_date': D['generated'], 'built_at': dt.datetime.now(dt.timezone.utc).isoformat(), 'google': t['google'], 'aio': t['aio'],
           'chatgpt': t['chatgpt'], 'gsc': t['gsc'], 'aimode': t['aimode'], 'annotations': len(D['annotations']), 'payload_kb': kb, 'mode': mode}
    load_tables({'build_log': [row]}, c)


def main(argv=None):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('setup')
    l = sub.add_parser('load')
    l.add_argument('raw', nargs='+')
    a = ap.parse_args(argv)
    c = client()
    setup(c)
    if a.cmd == 'load':
        from . import aimode
        for p in a.raw:
            print(f'Loading {p}')
            load_tables(aimode.transform_files([p]), c)


if __name__ == '__main__':
    main()
