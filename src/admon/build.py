"""Turn the source rows (sources.py) and the monitor's own tables (bq.py) into the dashboard payload.

The payload is one JSON object that dashboard/app.js reads; its keys are documented in README.md.
Everything here is pure Python on lists of dicts, so tests can run it on synthetic rows.
"""
import collections
import datetime as dt
import re

from . import config

CL_IDS = None


def _cl_ids():
    return [c for c, _ in config.cluster_labels()]


def _r(v, d=2):
    return None if v is None else round(v, d)


def _monday(s):
    d = dt.date.fromisoformat(s)
    return (d - dt.timedelta(days=d.weekday())).isoformat()


def norm_prompt(p):
    return re.sub(r'\s+', ' ', (p or '').replace('​', '')).strip()


# ---------------------------------------------------------------- Google (FolloEngine SERP)
def google(S, cfg):
    own = cfg['client']['domain']
    cls = _cl_ids()
    kd = S['serp_kd']
    dates = sorted({r['d'] for r in kd})
    di = {d: i for i, d in enumerate(dates)}
    kcl = {}
    tot = collections.defaultdict(lambda: [0.0, 0.0, 0])          # (d, cl) -> est, own, kw
    for r in kd:
        cl = kcl.setdefault(r['keyword'], config.classify('keyword', r['keyword']))
        for c in (cl, 'alle'):
            a = tot[(r['d'], c)]
            a[0] += r['est'] or 0
            a[1] += r['own'] or 0
            a[2] += 1
    share = lambda d, c: _r(tot[(d, c)][1] / tot[(d, c)][0] * 100) if tot[(d, c)][0] else None
    fe_trend = [[d, share(d, 'alle'), round(tot[(d, 'alle')][1]), round(tot[(d, 'alle')][0]), tot[(d, 'alle')][2]] for d in dates]

    # domains per cluster (and summed for 'alle')
    dom = collections.defaultdict(lambda: collections.defaultdict(float))   # (cl, dom) -> d -> traffic
    for r in S['serp_dom']:
        dom[(r['cl'], r['dom'])][r['d']] += r['t'] or 0
        dom[('alle', r['dom'])][r['d']] += r['t'] or 0
    last = dates[-1]

    def domains(c, n):
        ds = [k[1] for k in dom if k[0] == c]
        ds.sort(key=lambda x: -dom[(c, x)].get(last, 0))
        top = ds[:n]
        if own in ds and own not in top:
            top.append(own)
        return {x: [_r(dom[(c, x)][d] / tot[(d, c)][0] * 100) if dom[(c, x)].get(d) and tot[(d, c)][0] else None for d in dates] for x in top}

    fe_cl = {'alle': {'share': [r[1] for r in fe_trend], 'kw': fe_trend[-1][4], 'domains': domains('alle', 11)}}
    for c in cls:
        fe_cl[c] = {'share': [share(d, c) for d in dates], 'kw': tot[(last, c)][2], 'domains': domains(c, 8)}

    # position distribution and keyword history
    pos = collections.defaultdict(dict)
    sv = {}
    for r in kd:
        pos[r['keyword']][r['d']] = r['pos']
        if r['d'] == last or r['keyword'] not in sv:
            sv[r['keyword']] = r['sv'] or 0
    dist = []
    for d in dates:
        ps = [pos[k][d] for k in pos if d in pos[k]]
        b = lambda lo, hi: sum(1 for p in ps if p is not None and lo <= p <= hi)
        dist.append([d, b(1, 1), b(2, 3), b(4, 6), b(7, 10), b(11, 25), sum(1 for p in ps if p is not None)])
    lastkw = [k for k in pos if last in pos[k]]
    top = sorted(lastkw, key=lambda k: (-sv[k], k))[:cfg['dashboard']['top_keywords']]
    fe_kw = {k: {'sv': sv[k], 'pos': [pos[k].get(d) for d in dates], 'cl': kcl[k]} for k in top}
    return {'fe_dates': dates, 'fe_trend': fe_trend, 'fe_domains': fe_cl['alle']['domains'], 'fe_cl': fe_cl,
            'fe_dist': dist, 'fe_kw': fe_kw}, {'kcl': kcl, 'sv': sv, 'kd': kd, 'dates': dates}


# ---------------------------------------------------------------- AI Overviews
def aio(S, cfg, G):
    cls = _cl_ids()
    kcl, sv = G['kcl'], G['sv']
    serp_by_d = collections.defaultdict(dict)        # d -> keyword -> serp says AIO
    for r in G['kd']:
        serp_by_d[r['d']][r['keyword']] = bool(r['aio'])
    ak = collections.defaultdict(dict)               # d -> keyword -> ad_rank (0 = AIO without AD)
    for r in S['aio_kd']:
        ak[r['d']][r['keyword']] = r['ad_rank'] or 0
    dates = sorted(ak)
    serp_dates = sorted(serp_by_d)

    def serp_for(d):  # the SERP measurement of the same day, else the closest one before it
        best = None
        for x in serp_dates:
            if x <= d:
                best = x
        return serp_by_d.get(best or d, {})

    trend, cl_share, cl_trig = [], collections.defaultdict(list), collections.defaultdict(list)
    for d in dates:
        a, s = ak[d], serp_for(d)
        n, y, totkw = len(a), sum(1 for v in a.values() if v > 0), len(s) or None
        serp_aio = sum(1 for v in s.values() if v)
        incomplete = bool(serp_aio and n < 0.7 * serp_aio)
        trend.append([d, n, totkw, y, _r(y / n * 100, 1) if n else None, _r(n / totkw * 100, 1) if totkw else None, incomplete])
        for c in cls:
            ks = [k for k in s if kcl.get(k, config.classify('keyword', k)) == c]
            ac = [k for k in a if kcl.get(k, config.classify('keyword', k)) == c]
            yc = sum(1 for k in ac if a[k] > 0)
            cl_share[c].append(_r(yc / len(ac) * 100, 1) if ac else None)
            cl_trig[c].append(_r(len(ac) / len(ks) * 100, 1) if ks else None)
    aio_cl = {'alle': {'share': [r[4] for r in trend], 'trig': [r[5] for r in trend]}}
    for c in cls:
        aio_cl[c] = {'share': cl_share[c], 'trig': cl_trig[c]}

    # domains
    dd = collections.defaultdict(dict)
    for r in S['aio_dom']:
        dd[r['dom']][r['d']] = r['k']
    tot_aio = sum(r[1] for r in trend) or 1
    lb = sorted(dd, key=lambda x: -sum(dd[x].values()))
    aio_leaderboard = [[x, sum(dd[x].values()), _r(sum(dd[x].values()) / tot_aio * 100, 1)] for x in lb[:15]]
    aio_domains = {x: [dd[x].get(d) for d in dates] for x in lb[:8]}

    # per keyword: summary and history
    kws = set(k for d in dates for k in ak[d]) | set(sv)
    summ = []
    for k in kws:
        seen = [d for d in serp_dates if k in serp_by_d[d]]
        with_aio = [d for d in dates if k in ak[d]]
        if not with_aio:
            continue
        cited = [d for d in with_aio if ak[d][k] > 0]
        rec = with_aio[-5:]
        summ.append({'kw': k, 'sv': sv.get(k, 0), 'aio': _r(len(with_aio) / max(len(seen), len(with_aio)), 3),
                     'our': _r(len(cited) / len(with_aio), 3), 'recent': round(sum(1 for d in rec if ak[d][k] > 0) / len(rec) * 100),
                     'dates': len(seen), 'cl': kcl.get(k, config.classify('keyword', k))})
    summ.sort(key=lambda r: (-r['sv'], r['kw']))
    hd = dates[-cfg['dashboard']['hist_columns']:]
    hist = {}
    for r in summ[:cfg['dashboard']['aio_hist_keywords']]:
        k = r['kw']
        v = []
        for d in hd:
            if k in ak[d]:
                v.append(ak[d][k])
            elif k in serp_for(d):
                v.append(-1)
            else:
                v.append(None)
        hist[k] = {'sv': r['sv'], 'cl': r['cl'], 'v': v, 'dates': hd,
                   'cited': [None if x is None or x == -1 else (1 if x > 0 else 0) for x in v]}
    return {'aio_trend': trend, 'aio_cl': aio_cl, 'aio_domains': aio_domains, 'aio_leaderboard': aio_leaderboard,
            'aio_kw': summ[:cfg['dashboard']['aio_keywords']], 'aio_kw_hist': hist, 'aio_hist_dates': hd}


# ---------------------------------------------------------------- ChatGPT
def chatgpt(S, cfg):
    pd = collections.defaultdict(dict)                      # d -> prompt -> (m, c)
    for r in S['llm_pd']:
        p = norm_prompt(r['prompt'])
        m0, c0 = pd[r['d']].get(p, (False, False))
        pd[r['d']][p] = (m0 or bool(r['m']), c0 or bool(r['c']))
    dates = sorted(pd)
    trend = [[d, len(pd[d]), sum(1 for m, c in pd[d].values() if m), sum(1 for m, c in pd[d].values() if c)] for d in dates]
    total = {d: len(pd[d]) for d in dates}

    def series(rows):
        b = collections.defaultdict(dict)
        for r in rows:
            b[r['v']][r['d']] = r['n']
        return b
    br, ci = series(S['llm_brand']), series(S['llm_cite'])
    own_re = re.compile(cfg['client']['mention_pattern'], re.I)
    own_key = next((v for v in br if own_re.search(v)), None)
    comp = [v for v in sorted(br, key=lambda v: -sum(br[v].values())) if v != own_key][:7]
    gpt_mentions = {'allianz direct': [_r(r[2] / r[1] * 100, 1) if r[1] else None for r in trend]}
    for v in comp:
        gpt_mentions[v] = [_r(br[v][d] / total[d] * 100, 1) if br[v].get(d) and total[d] else None for d in dates]
    all_answers = sum(total.values()) or 1
    lb = lambda b: [{'name': v, 'total_answers': sum(b[v].values()), 'answer_share': round(sum(b[v].values()) / all_answers, 4)}
                    for v in sorted(b, key=lambda v: -sum(b[v].values()))[:10]]
    mlb = [{'mention': x['name'], 'total_answers': x['total_answers'], 'answer_share': x['answer_share']} for x in lb(br)]
    for x in mlb:
        if own_re.search(x['mention']):
            x['mention'] = 'allianz direct'
    clb = [{'citation': x['name'], 'total_answers': x['total_answers'], 'answer_share': x['answer_share']} for x in lb(ci)]

    # per prompt
    prompts = collections.defaultdict(lambda: {'m': [], 'c': []})
    for d in dates:
        for p, (m, c) in pd[d].items():
            prompts[p]['m'].append(d if m else None)
            prompts[p]['c'].append(d if c else None)
    gpt_prompts = []
    for p, v in prompts.items():
        ml, cl_ = [x for x in v['m'] if x], [x for x in v['c'] if x]
        if not ml and not cl_:
            continue
        n = len(v['m'])
        gpt_prompts.append({'prompt': p, 'mention_last': max(ml) if ml else '', 'citation_last': max(cl_) if cl_ else '',
                            'mention_pct': round(len(ml) / n * 100), 'citation_pct': round(len(cl_) / n * 100),
                            'cl': config.classify('prompt', p)})
    gpt_prompts.sort(key=lambda r: (-r['mention_pct'], -r['citation_pct'], r['prompt']))
    hd = dates[-cfg['dashboard']['gpt_hist_columns']:]
    rows = {}
    for p in prompts:
        v = []
        for d in hd:
            m, c = pd[d].get(p, (False, False))
            v.append(3 if m and c else 2 if m else 1 if c else 0)
        if any(v):
            rows[p] = {'cl': config.classify('prompt', p), 'v': v}
    answers = [{'date': r['d'], 'prompt': norm_prompt(r['prompt']), 'mention': 'yes' if r['m'] else 'no', 'citation': 'yes' if r['c'] else 'no',
                'answer': r['answer'] or '', 'cites': list(r['cites'] or [])[:12]} for r in S['llm_answers']]
    answers.sort(key=lambda a: (a['date'], a['mention'] == 'yes', a['citation'] == 'yes'), reverse=True)
    return {'gpt_trend': trend, 'gpt_mentions': gpt_mentions, 'gpt_mentions_lb': mlb, 'gpt_citations_lb': clb,
            'gpt_prompts': gpt_prompts, 'gpt_answers': answers, 'gpt_hist': {'dates': hd, 'rows': rows}}


# ---------------------------------------------------------------- Search Console
def gsc(S, cfg):
    cls = _cl_ids()
    days = collections.Counter()
    q = collections.defaultdict(lambda: [0, 0, 0.0])
    for r in S['gsc_q_week']:
        days[r['w']] = max(days[r['w']], r['days'] or 0)
        for c in (r['cl'], 'alle'):
            a = q[(r['w'], c)]
            a[0] += r['c'] or 0
            a[1] += r['i'] or 0
            a[2] += r['pw'] or 0
    p = collections.defaultdict(lambda: [0, 0, 0.0])
    for r in S['gsc_p_week']:
        for c in (r['cl'], 'alle'):
            a = p[(r['w'], c)]
            a[0] += r['c'] or 0
            a[1] += r['i'] or 0
            a[2] += r['pw'] or 0
    weeks = sorted(w for w in days if days[w] == 7)       # complete weeks only
    pos = lambda a: _r(a[2] / a[1]) if a[1] else None
    gsc_weekly = [[w, q[(w, 'alle')][0], q[(w, 'alle')][1], pos(q[(w, 'alle')])] for w in weeks]
    gsc_cl = {}
    for c in ['alle'] + cls:
        gsc_cl[c] = {'url_impr': [p[(w, c)][1] for w in weeks], 'url_pos': [pos(p[(w, c)]) for w in weeks],
                     'q_impr': [q[(w, c)][1] for w in weeks], 'q_pos': [pos(q[(w, c)]) for w in weeks]}

    def tops(rows, n):
        out = collections.defaultdict(list)
        for r in rows:
            out[r['w']].append([r['k'], r['c'], r['i'], _r(r['pw'] / r['i'], 1) if r['i'] else None])
        return {w: sorted(v, key=lambda x: -x[2])[:n] for w, v in out.items() if w in set(weeks)}
    brand = re.compile(cfg['client']['brand_pattern'], re.I)
    hist = collections.defaultdict(dict)
    impr = collections.Counter()
    for r in S['gsc_q_hist']:
        if r['w'] in set(weeks):
            hist[r['k']][r['w']] = _r(r['pw'] / r['i'], 1) if r['i'] else None
            impr[r['k']] += r['i'] or 0
    qh = {k: {'brand': bool(brand.search(k)), 'impr': impr[k], 'cl': config.classify('keyword', k),
              'pos': [hist[k].get(w) for w in weeks]} for k, _ in impr.most_common()}
    return {'gsc_weekly': gsc_weekly, 'gsc_cl': gsc_cl, 'gsc_week_queries': tops(S['gsc_top_q'], 40),
            'gsc_week_pages': tops(S['gsc_top_p'], 25), 'gsc_query_hist': qh}


# ---------------------------------------------------------------- AI Mode (own runs)
def aimode(own_rows, cfg, sv):
    kws = cfg['aimode']['keywords']
    runs = sorted({r['run_date'] for r in own_rows})
    by = collections.defaultdict(dict)
    for r in own_rows:
        by[r['keyword']][r['run_date']] = r
    last = runs[-1] if runs else None
    rows = []
    for k in kws:
        r = by.get(k, {}).get(last)
        if not r or r.get('status') != 'ok':
            continue
        rows.append({'kw': k, 'sv': sv.get(k) or None, 'mentioned': bool(r['mentioned']), 'cited': bool(r['cited']),
                     'ad_url': r.get('own_url'), 'mention_text': r.get('mention_text'), 'refs': list(r.get('ref_domains') or []),
                     'check': r.get('check_url') or f'https://www.google.com/search?q={k}&hl=nl&gl=NL&udm=50',
                     'cl': config.classify('keyword', k)})
    rows.sort(key=lambda r: -(r['sv'] or 0))
    hist = {}
    for k in kws:
        ds = [d for d in runs if d in by.get(k, {}) and by[k][d].get('status') == 'ok']
        if ds:
            hist[k] = {'dates': ds, 'cited': [1 if by[k][d]['cited'] else 0 for d in ds],
                       'mentioned': [1 if by[k][d]['mentioned'] else 0 for d in ds]}
    a = cfg['aimode']
    return {'aimode': {'scraped': last, 'device': a['device'], 'location': 'Nederland', 'total_planned': len(kws), 'runs': len(runs), 'rows': rows},
            'aimode_hist': hist}


# ---------------------------------------------------------------- everything
def build_data(S, own, cfg=None, annotations=None, today=None):
    """S: source rows per query name; own: {'aimode_results': [...], 'annotations': [...]}."""
    cfg = cfg or config.load()
    today = today or dt.date.today().isoformat()
    D = {'generated': today, 'domain': cfg['client']['domain'], 'clusters': config.cluster_labels()}
    g, G = google(S, cfg)
    D.update(g)
    D.update(aio(S, cfg, G))
    D.update(chatgpt(S, cfg))
    D.update(gsc(S, cfg))
    D.update(aimode(own.get('aimode_results', []), cfg, G['sv']))
    D['data_through'] = {'google': D['fe_dates'][-1], 'aio': D['aio_trend'][-1][0] if D['aio_trend'] else None,
                         'chatgpt': D['gpt_trend'][-1][0] if D['gpt_trend'] else None,
                         'gsc': (dt.date.fromisoformat(D['gsc_weekly'][-1][0]) + dt.timedelta(days=6)).isoformat() if D['gsc_weekly'] else None,
                         'aimode': D['aimode']['scraped']}
    from . import annotations as ann
    D['annotations'] = ann.merge(own.get('annotations', []), annotations or [], ann.auto_doubts(D, cfg, today))
    return D
