"""Read the source data (FolloEngine tables and the Search Console export) from BigQuery.

Every query aggregates in BigQuery, so only compact rows reach the build step. The queries return plain
lists of dicts; build.py turns them into the dashboard payload. QUERIES is the single place to change what
is read, and tests/test_pipeline.py runs build.py on synthetic rows with exactly these keys.
"""
from . import config

OWN = '@own'


def _q():
    c = config.load()
    s = c['sources']
    kw_cl = config.cluster_sql('keyword', 'keyword')
    q_cl = config.cluster_sql('keyword', 'query')
    url_cl = config.cluster_sql('url', 'page')
    is_yes = lambda col: f"CAST({col} AS STRING) IN ('yes', 'true', '1')"
    gsc_where = f"date >= @start AND country = '{s['gsc_country']}' AND search_type = '{s['gsc_search_type']}'"
    week = 'DATE_TRUNC(date, WEEK(MONDAY))'
    return {
        # one row per measurement and keyword: volume, own blue-link position, AIO shown, traffic shares
        'serp_kd': f"""
            SELECT scraped_date AS d, keyword, ANY_VALUE(search_volume) AS sv, MIN(our_position_blue_links) AS pos,
                   LOGICAL_OR(is_ai_overview = 'yes') AS aio, SUM(estimated_traffic) AS est,
                   SUM(IF(root_domain = {OWN}, estimated_traffic, 0)) AS own
            FROM {config.src('serp')} WHERE scraped_date >= @start GROUP BY 1, 2""",
        # estimated traffic per measurement, cluster and domain, for the domains that matter at the last measurement
        'serp_dom': f"""
            WITH b AS (
              SELECT scraped_date AS d, {kw_cl} AS cl, root_domain AS dom, SUM(estimated_traffic) AS t
              FROM {config.src('serp')} WHERE scraped_date >= @start AND root_domain IS NOT NULL GROUP BY 1, 2, 3),
            md AS (SELECT MAX(d) AS m FROM b),
            pick AS (
              SELECT dom FROM (SELECT cl, dom, ROW_NUMBER() OVER (PARTITION BY cl ORDER BY t DESC) AS rn FROM b, md WHERE d = m) WHERE rn <= 10
              UNION DISTINCT SELECT dom FROM (SELECT dom, SUM(t) AS s FROM b, md WHERE d = m GROUP BY dom ORDER BY s DESC LIMIT 12)
              UNION DISTINCT SELECT {OWN})
            SELECT b.* FROM b JOIN pick USING (dom)""",
        # one row per measurement and keyword with an AI Overview: number of cited domains and the rank of AD
        'aio_kd': f"""
            WITH a AS (
              SELECT scraped_date AS d, keyword, root_domain AS dom, MIN(passage_order) AS po, MIN(url) AS u
              FROM {config.src('aio')} WHERE scraped_date >= @start GROUP BY 1, 2, 3),
            r AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY d, keyword ORDER BY po IS NULL, po, u) AS rk FROM a WHERE dom IS NOT NULL)
            SELECT d, keyword, COUNT(*) AS ndom, MIN(IF(dom = {OWN}, rk, NULL)) AS ad_rank FROM r GROUP BY 1, 2""",
        'aio_dom': f"""
            WITH b AS (
              SELECT scraped_date AS d, root_domain AS dom, COUNT(DISTINCT keyword) AS k
              FROM {config.src('aio')} WHERE scraped_date >= @start AND root_domain IS NOT NULL GROUP BY 1, 2),
            top AS (SELECT dom FROM b GROUP BY dom ORDER BY SUM(k) DESC LIMIT 15)
            SELECT * FROM b WHERE dom IN (SELECT dom FROM top) OR dom = {OWN}""",
        # ChatGPT: one row per measurement and prompt
        'llm_pd': f"""
            SELECT scraped_date AS d, prompt, LOGICAL_OR({is_yes('calc_our_mention_in_answer')}) AS m,
                   LOGICAL_OR({is_yes('calc_our_citation_in_answer')}) AS c
            FROM {config.src('llm')} WHERE scraped_date >= @start GROUP BY 1, 2""",
        'llm_brand': f"""
            WITH b AS (
              SELECT scraped_date AS d, mention_cleaned AS v, COUNT(DISTINCT prompt) AS n
              FROM {config.src('llm')} WHERE {is_yes('is_mention_row')} AND mention_cleaned IS NOT NULL GROUP BY 1, 2),
            top AS (SELECT v FROM b GROUP BY v ORDER BY SUM(n) DESC LIMIT 12)
            SELECT * FROM b WHERE v IN (SELECT v FROM top) OR REGEXP_CONTAINS(LOWER(v), r'allianz')""",
        'llm_cite': f"""
            WITH b AS (
              SELECT scraped_date AS d, citation_root_domain AS v, COUNT(DISTINCT prompt) AS n
              FROM {config.src('llm')} WHERE {is_yes('is_citation_row')} AND citation_root_domain IS NOT NULL GROUP BY 1, 2),
            top AS (SELECT v FROM b GROUP BY v ORDER BY SUM(n) DESC LIMIT 12)
            SELECT * FROM b WHERE v IN (SELECT v FROM top) OR v = {OWN}""",
        'llm_answers': f"""
            WITH last2 AS (SELECT DISTINCT scraped_date FROM {config.src('llm')} ORDER BY scraped_date DESC LIMIT 2)
            SELECT scraped_date AS d, prompt, ANY_VALUE(SUBSTR(full_markdown, 1, 1800)) AS answer,
                   LOGICAL_OR({is_yes('calc_our_mention_in_answer')}) AS m, LOGICAL_OR({is_yes('calc_our_citation_in_answer')}) AS c,
                   ARRAY_AGG(DISTINCT IF({is_yes('is_citation_row')}, citation_url, NULL) IGNORE NULLS) AS cites
            FROM {config.src('llm')} WHERE scraped_date IN (SELECT scraped_date FROM last2) GROUP BY 1, 2""",
        # Search Console, query level (every query counts with its own position)
        'gsc_q_week': f"""
            SELECT {week} AS w, {q_cl} AS cl, SUM(clicks) AS c, SUM(impressions) AS i, SUM(position * impressions) AS pw,
                   COUNT(DISTINCT date) AS days
            FROM {config.src('gsc_queries')} WHERE {gsc_where} GROUP BY 1, 2""",
        # Search Console, URL level (every page counts with its own position)
        'gsc_p_week': f"""
            SELECT {week} AS w, {url_cl} AS cl, SUM(clicks) AS c, SUM(impressions) AS i, SUM(position * impressions) AS pw,
                   COUNT(DISTINCT date) AS days
            FROM {config.src('gsc_page_queries')} WHERE {gsc_where} GROUP BY 1, 2""",
        'gsc_top_q': f"""
            WITH b AS (SELECT {week} AS w, query AS k, SUM(clicks) AS c, SUM(impressions) AS i, SUM(position * impressions) AS pw
                       FROM {config.src('gsc_queries')} WHERE {gsc_where} AND query IS NOT NULL GROUP BY 1, 2)
            SELECT * FROM b QUALIFY ROW_NUMBER() OVER (PARTITION BY w ORDER BY i DESC) <= 40""",
        'gsc_top_p': f"""
            WITH b AS (SELECT {week} AS w, page AS k, SUM(clicks) AS c, SUM(impressions) AS i, SUM(position * impressions) AS pw
                       FROM {config.src('gsc_page_queries')} WHERE {gsc_where} AND page IS NOT NULL GROUP BY 1, 2)
            SELECT * FROM b QUALIFY ROW_NUMBER() OVER (PARTITION BY w ORDER BY i DESC) <= 25""",
        'gsc_q_hist': f"""
            WITH t AS (SELECT query FROM {config.src('gsc_queries')} WHERE {gsc_where} AND query IS NOT NULL
                       GROUP BY query ORDER BY SUM(impressions) DESC LIMIT {int(c['dashboard']['gsc_top_queries'])})
            SELECT {week} AS w, query AS k, SUM(impressions) AS i, SUM(position * impressions) AS pw
            FROM {config.src('gsc_queries')} WHERE {gsc_where} AND query IN (SELECT query FROM t) GROUP BY 1, 2""",
    }


def queries():
    return _q()


def fetch(client):
    """Run every source query; returns {name: [row dicts]} with dates as ISO strings."""
    from google.cloud import bigquery as bq
    c = config.load()
    params = [bq.ScalarQueryParameter('own', 'STRING', c['client']['domain']),
              bq.ScalarQueryParameter('start', 'DATE', c['sources']['start'])]
    out = {}
    for name, sql in queries().items():
        job = client.query(sql, job_config=bq.QueryJobConfig(query_parameters=params))
        rows = [dict(r) for r in job.result()]
        for r in rows:
            for k, v in r.items():
                if hasattr(v, 'isoformat'):
                    r[k] = v.isoformat()
                elif v is not None and type(v).__name__ == 'Decimal':
                    r[k] = float(v)
        out[name] = rows
        print(f'  {name:12s} {len(rows):7d} rows  {(job.total_bytes_processed or 0) / 1e9:.2f} GB')
    return out
