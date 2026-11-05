"""Annotations: Google Search Status updates (public), the team's own annotations (BigQuery table
`annotations`, filled by the monthly Claude task or by hand) and automatic data-quality flags.

Annotation shape: {date, type: google|change|pr|data, title, detail, source, url, tabs: [all|google|aio|chatgpt|aimode]}
"""
import datetime as dt

STATUS_URL = 'https://status.search.google.com/incidents.json'


def google_status(session=None, since='2025-05-01'):
    """Ranking updates from the Google Search Status Dashboard. Returns [] when the page is unreachable."""
    import requests
    s = session or requests
    try:
        rows = s.get(STATUS_URL, timeout=30).json()
    except Exception as e:  # the dashboard still builds without them
        print(f'Google Search Status niet bereikbaar ({e.__class__.__name__})')
        return []
    out = []
    for r in rows:
        prods = {p.get('title') if isinstance(p, dict) else str(p) for p in (r.get('affected_products') or [])}
        begin = (r.get('begin') or '')[:10]
        if not begin or begin < since or 'Ranking' not in prods:
            continue
        end = (r.get('end') or '')[:10]
        title = (r.get('external_desc') or 'Google-update').strip()
        detail = 'Google-update gestart' + (f', uitrol klaar op {end}.' if end else ', uitrol loopt nog.')
        out.append({'date': begin, 'type': 'google', 'title': title, 'detail': detail, 'source': 'Google Search Status',
                    'url': 'https://status.search.google.com' + (r.get('uri') or '/'), 'tabs': ['all']})
    return out


def auto_doubts(D, cfg, today):
    """Data-quality flags derived from the data itself, from cfg.dashboard.auto_doubts_from on."""
    since = cfg['dashboard'].get('auto_doubts_from') or '1900-01-01'
    out = []
    add = lambda d, title, detail, tabs: out.append({'date': d, 'type': 'data', 'title': title, 'detail': detail,
                                                     'source': 'Automatische controle', 'url': '', 'tabs': tabs})
    fe = D['fe_trend']
    for a, b in zip(fe, fe[1:]):
        if b[0] < since:
            continue
        if a[4] and abs(b[4] - a[4]) / a[4] > 0.05:
            add(b[0], f'Zoekwoordenset FolloEngine gewijzigd ({a[4]} naar {b[4]})', 'Marktaandeel en aantallen zijn rond deze datum niet één op één vergelijkbaar.', ['google', 'aio'])
        gap = (dt.date.fromisoformat(b[0]) - dt.date.fromisoformat(a[0])).days
        if gap > 10:
            add(b[0], f'{gap} dagen tussen twee metingen', 'Er ontbreken FolloEngine-scrapes; streaks tellen deze periode niet mee.', ['google', 'aio'])
        if a[3] and b[3] > 1.6 * a[3] and b[4] <= a[4] * 1.05:
            add(b[0], 'Totaalverkeer FolloEngine bijna verdubbeld', 'Mogelijk dubbele meting; marktaandeel kan vertekend zijn.', ['google'])
    for r in D['aio_trend']:
        if r[0] >= since and r[6]:
            add(r[0], 'AIO-meting onvolledig', 'FolloEngine las niet alle AI Overviews uit; het citatieaandeel kan te laag zijn.', ['aio'])
    gt = D['gpt_trend']
    usual = sorted(r[1] for r in gt)[len(gt) // 2] if gt else 0
    for r in gt:
        if r[0] >= since and usual and r[1] < 0.9 * usual:
            add(r[0], f'ChatGPT-meting onvolledig ({r[1]} van {usual} prompts)', 'Aandelen voor deze week zijn minder betrouwbaar.', ['chatgpt'])
    # stale sources at build time
    t = dt.date.fromisoformat(today)
    for key, label, tabs, limit in [('google', 'FolloEngine Google', ['google', 'aio'], 10), ('chatgpt', 'FolloEngine ChatGPT', ['chatgpt'], 10),
                                    ('gsc', 'Search Console-export', ['google'], 14)]:
        last = D['data_through'].get(key)
        if last and (t - dt.date.fromisoformat(last)).days > limit and today >= since:
            add(today, f'{label}: laatste data van {last}', 'De bron is niet bijgewerkt; controleer de koppeling in FolloEngine of Windsor.', tabs)
    return out


def merge(own, google, auto):
    """Own annotations win over automatic ones on the same date and title; sorted by date."""
    seen, out = set(), []
    for a in list(own) + list(google) + list(auto):
        a = dict(a)
        a['date'] = a['date'].isoformat() if hasattr(a['date'], 'isoformat') else str(a['date'])[:10]
        a['tabs'] = list(a.get('tabs') or ['all'])
        a.setdefault('detail', '')
        a.setdefault('url', '')
        a.setdefault('source', '')
        k = (a['date'], a['title'].lower())
        if k in seen:
            continue
        seen.add(k)
        out.append({k2: a.get(k2) for k2 in ('date', 'type', 'title', 'detail', 'source', 'url', 'tabs')})
    return sorted(out, key=lambda a: a['date'])
