"""Configuration (config/allianzdirect.yaml) and environment settings."""
import os
import re
from functools import lru_cache
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = Path(os.environ.get('ADMON_CONFIG', ROOT / 'config' / 'allianzdirect.yaml'))


@lru_cache
def load():
    return yaml.safe_load(CONFIG_PATH.read_text(encoding='utf-8'))


def env(name, default=None, required=False):
    v = os.environ.get(name, default)
    if required and not v:
        raise SystemExit(f'Missing environment variable {name}')
    return v


BQ_PROJECT = lambda: env('GCP_PROJECT_ID', required=True)
BQ_DATASET = lambda: env('BQ_DATASET', 'allianzdirect_monitor')
BQ_LOCATION = lambda: env('BQ_LOCATION', 'EU')


def src(name):
    """Fully qualified source table, e.g. src('serp') -> `folloagency.google_search_reporting.x`."""
    c = load()['sources']
    return f"`{c['project']}.{c[name]}`"


# ---------- cluster rules: one definition, used in Python and in BigQuery ----------
def _rules(kind):
    c = load()['clusters']
    rules = {'keyword': c['keyword_rules'], 'url': c['url_rules'], 'prompt': c['prompt_rules']}[kind]
    default = {'keyword': c['default'], 'url': c['url_default'], 'prompt': c['prompt_default']}[kind]
    return rules, default


def classify(kind, text):
    rules, default = _rules(kind)
    t = (text or '').lower()
    if kind == 'url':
        t = re.sub(r'^https?://[^/]+', '', t)
    for cl, pat in rules:
        if re.search(pat, t):
            return cl
    return default


def cluster_sql(kind, col):
    """The same rules as a BigQuery CASE expression (RE2 syntax)."""
    rules, default = _rules(kind)
    expr = f'LOWER({col})'
    if kind == 'url':
        expr = f"REGEXP_REPLACE(LOWER({col}), r'^https?://[^/]+', '')"
    whens = ' '.join(f"WHEN REGEXP_CONTAINS({expr}, r'{pat}') THEN '{cl}'" for cl, pat in rules)
    return f"(CASE {whens} ELSE '{default}' END)"


def cluster_labels():
    return list(load()['clusters']['labels'].items())
