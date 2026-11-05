"""Synthetic source rows in exactly the shape of sources.queries(), for offline tests and local previews.

Everything here is made up: fictional competitor domains, random numbers. No client data.
"""
import datetime as dt
import random

TODAY = '2026-11-16'
OWN = 'allianzdirect.nl'
COMP = ['vergelijker-een.nl', 'verzekeraar-twee.nl', 'consument-drie.nl', 'polis-vier.nl', 'premie-vijf.nl', 'dekking-zes.nl']
KEYWORDS = ['autoverzekering', 'auto verzekeren', 'autoverzekering vergelijken', 'goedkope autoverzekering', 'wa verzekering',
            'all risk verzekering', 'autoschade melden', 'groene kaart', 'ruitschade', 'pechhulp', 'inboedelverzekering',
            'opstalverzekering', 'aansprakelijkheidsverzekering', 'reisverzekering', 'annuleringsverzekering', 'doorlopende reisverzekering',
            'rechtsbijstandverzekering', 'dagwaarde auto', 'verzekering afsluiten', 'autoverzekering jongeren']
PROMPTS = ['Wat is de goedkoopste autoverzekering?', 'Welke inboedelverzekering is het best?', 'Hoe werkt een reisverzekering?',
           'Is Allianz Direct een goede verzekeraar?', 'Waar sluit ik snel een autoverzekering af?', 'Wat dekt een WA-verzekering?',
           'Wie heeft de laagste premie voor autoverzekeringen?', 'Heb ik een annuleringsverzekering nodig?']
BRANDS = ['allianz direct', 'merk een', 'merk twee', 'merk drie', 'merk vier']
PAGES = ['/autoverzekering/', '/autoverzekering/wa/', '/autoverzekering/schade-melden/', '/woonverzekering/inboedelverzekering/',
         '/reisverzekering/', '/rechtsbijstandverzekering/', '/klantenservice/', '/']


def _dates(n, end, step=7):
    e = dt.date.fromisoformat(end)
    return [(e - dt.timedelta(days=step * i)).isoformat() for i in range(n)][::-1]


def sources(seed=7):
    rnd = random.Random(seed)
    serp_dates = _dates(30, '2026-11-15')
    S = {k: [] for k in ['serp_kd', 'serp_dom', 'aio_kd', 'aio_dom', 'llm_pd', 'llm_brand', 'llm_cite', 'llm_answers',
                         'gsc_q_week', 'gsc_p_week', 'gsc_top_q', 'gsc_top_p', 'gsc_q_hist']}
    sv = {k: rnd.choice([1300, 2400, 5400, 9900, 14800, 22200, 60500]) for k in KEYWORDS}
    import sys, pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'src'))
    from admon import config
    for i, d in enumerate(serp_dates):
        dom_t = {}
        for k in KEYWORDS:
            pos = rnd.choice([1, 2, 3, 5, 8, 12, 20, None])
            est = sv[k] * 0.4
            own = est * {1: .3, 2: .15, 3: .1, 5: .05, 8: .02, 12: .01, 20: .005}.get(pos, 0)
            aio = rnd.random() < .8
            S['serp_kd'].append({'d': d, 'keyword': k, 'sv': sv[k], 'pos': pos, 'aio': aio, 'est': est, 'own': own})
            cl = config.classify('keyword', k)
            for c in COMP:
                dom_t[(cl, c)] = dom_t.get((cl, c), 0) + est * rnd.uniform(.02, .2)
            dom_t[(cl, OWN)] = dom_t.get((cl, OWN), 0) + own
            if aio and not (i == 12 and rnd.random() < .5):     # one incomplete AIO measurement
                ndom = rnd.randint(3, 8)
                S['aio_kd'].append({'d': d, 'keyword': k, 'ndom': ndom, 'ad_rank': rnd.choice([None, None, 1, 2, 4])})
        for (cl, dom), t in dom_t.items():
            S['serp_dom'].append({'d': d, 'cl': cl, 'dom': dom, 't': t})
        for dom in COMP + [OWN]:
            S['aio_dom'].append({'d': d, 'dom': dom, 'k': rnd.randint(2, 15)})
    for d in _dates(20, '2026-11-12'):
        for p in PROMPTS:
            m = rnd.random() < .35
            S['llm_pd'].append({'d': d, 'prompt': p, 'm': m, 'c': m and rnd.random() < .4})
        for b in BRANDS:
            S['llm_brand'].append({'d': d, 'v': b, 'n': rnd.randint(0, 6)})
        for c in COMP[:4] + [OWN]:
            S['llm_cite'].append({'d': d, 'v': c, 'n': rnd.randint(0, 6)})
    for d in _dates(2, '2026-11-12'):
        for p in PROMPTS:
            S['llm_answers'].append({'d': d, 'prompt': p, 'answer': f'Voorbeeldantwoord op: {p}', 'm': rnd.random() < .3, 'c': False,
                                     'cites': ['https://vergelijker-een.nl/pagina']})
    gsc_weeks = _dates(40, '2026-11-02')   # Mondays; the last one is incomplete
    queries = KEYWORDS + ['allianz direct', 'allianz direct inloggen']
    for j, w in enumerate(gsc_weeks):
        days = 3 if j == len(gsc_weeks) - 1 else 7
        for q in queries:
            i = rnd.randint(200, 5000)
            p = rnd.uniform(2, 25)
            cl = config.classify('keyword', q)
            S['gsc_q_week'].append({'w': w, 'cl': cl, 'c': int(i * .03), 'i': i, 'pw': p * i, 'days': days})
            S['gsc_top_q'].append({'w': w, 'k': q, 'c': int(i * .03), 'i': i, 'pw': p * i})
            S['gsc_q_hist'].append({'w': w, 'k': q, 'i': i, 'pw': p * i})
        for pg in PAGES:
            i = rnd.randint(500, 9000)
            p = rnd.uniform(3, 20)
            u = 'https://www.allianzdirect.nl' + pg
            S['gsc_p_week'].append({'w': w, 'cl': config.classify('url', u), 'c': int(i * .03), 'i': i, 'pw': p * i})
            S['gsc_top_p'].append({'w': w, 'k': u, 'c': int(i * .03), 'i': i, 'pw': p * i})
    return S


def own(seed=3):
    rnd = random.Random(seed)
    import sys, pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'src'))
    from admon import config
    rows = []
    for d in ['2026-11-02', '2026-11-16']:
        for k in config.load()['aimode']['keywords']:
            cited = rnd.random() < .15
            rows.append({'run_date': d, 'keyword': k, 'status': 'ok', 'fetched_at': d + 'T06:00:00+00:00', 'mentioned': cited or rnd.random() < .2,
                         'cited': cited, 'own_url': 'https://www.allianzdirect.nl/' if cited else None, 'mention_text': None,
                         'ref_domains': rnd.sample(COMP, 3) + ([OWN] if cited else []), 'check_url': None})
    ann = [{'date': '2026-09-10', 'type': 'change', 'title': 'Voorbeeld: nieuwe pagina live', 'detail': 'Fictieve annotatie voor tests.',
            'source': 'Test', 'url': '', 'tabs': ['google']},
           {'date': '2026-10-01', 'type': 'pr', 'title': 'Voorbeeld: persbericht', 'detail': '', 'source': 'Test', 'url': '', 'tabs': ['all']}]
    return {'aimode_results': rows, 'annotations': ann}


def google_status():
    return [{'date': '2026-09-24', 'type': 'google', 'title': 'Voorbeeld spam update', 'detail': 'Google-update gestart.',
             'source': 'Google Search Status', 'url': 'https://status.search.google.com/', 'tabs': ['all']}]
