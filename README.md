# Allianz Direct Search & AI monitor

Een dashboard dat zichzelf bijwerkt. Het laat zien hoe vindbaar allianzdirect.nl is in Google (marktaandeel, vertoningen, posities), in AI Overviews, in ChatGPT en in Google AI Mode, naast annotaties: Google-updates, wijzigingen, PR en twijfels over de data.

Eigenaar: Tom Harteveld (Follo). Secrets staan in GitHub (Settings, Secrets and variables, Actions); de data staat in BigQuery, project `folloagency`, dataset `allianzdirect_monitor` (EU).

## Hoe het werkt

```
Elke maandag 05:17 UTC (GitHub Actions)
  ├─ even weken: Google AI Mode via DataForSEO (40 zoekwoorden, Standard Queue)  ->  BigQuery allianzdirect_monitor
  └─ dashboard bouwen uit BigQuery:
       FolloEngine  google_search_reporting.allianz_direct_nl_v2_serp_full_follo / _ai_overviews_follo
       FolloEngine  llm_reporting_tables.allianz_direct_nl_v2_llm_combined
       Windsor      gsc_queries.allianzdirect, gsc_page_queries.allianzdirect (alleen NL, web)
       eigen        allianzdirect_monitor.aimode_results, .annotations
       publiek      status.search.google.com (Google-updates)
  -> GitHub Pages: https://tomharteveld.github.io/allianzdirect-monitor/<DASHBOARD_PATH>/
  -> Follo Tools: iframe met wachtwoord

Begin van elke maand (geplande Claude-taak)
  Gmail, Slack en Notion doorzoeken op Allianz  ->  nieuwe regels in allianzdirect_monitor.annotations
```

Kosten: FolloEngine- en Search Console-data lezen kost niets extra (BigQuery, ongeveer 2,3 GB per build, ruim binnen het gratis deel). AI Mode: 40 Standard Queue-taken om de week, enkele dollarcenten per run, op het Follo DataForSEO-account. GitHub Actions en Pages zijn gratis voor deze publieke repository.

## Publieke repository: wat wel en niet hierin staat

Wel: code, de clusterregels en de AI Mode-zoekwoorden (`config/allianzdirect.yaml`) en synthetische testdata met fictieve domeinen.
Niet: klantdata, annotaties uit Gmail, Slack of Notion, credentials of het geheime pad. Annotaties staan in BigQuery, het dashboard staat alleen op het geheime pad, workflow-artifacts worden direct na de deploy verwijderd en de logs tonen alleen datums en aantallen.

## Structuur

```
config/allianzdirect.yaml     bronnen, clusterregels (één set voor Python en BigQuery), AI Mode-zoekwoorden
src/admon/sources.py          SQL op de brontabellen (aggregatie in BigQuery)
src/admon/aimode.py           AI Mode ophalen (Standard Queue, terugval op Live) en uitlezen
src/admon/bq.py               eigen dataset: aimode_results, raw_tasks, run_log, build_log, annotations
src/admon/annotations.py      Google Search Status, automatische datatwijfels, samenvoegen
src/admon/build.py            bronrijen -> dashboarddata (JSON)
src/admon/dashboard.py        één HTML-bestand naar site/<pad>/index.html
dashboard/template.html, app.js   het dashboard zelf (Follo-huisstijl)
.github/workflows/weekly.yml  schema en handmatige modi
scripts/setup_gcp.sh          eenmalige Google Cloud-setup zonder sleutels
tests/                        offline tests op synthetische data
```

## Eenmalige setup

1. Maak op GitHub een lege, publieke repository `tomharteveld/allianzdirect-monitor` (zonder README) en geef de Claude GitHub App toegang. Claude pusht de code; de workflow **Tests** moet groen worden.
2. Open Cloud Shell (https://shell.cloud.google.com/?project=folloagency) en draai:
   ```bash
   git clone https://github.com/tomharteveld/allianzdirect-monitor.git && cd allianzdirect-monitor
   PROJECT_ID=folloagency GITHUB_REPO=tomharteveld/allianzdirect-monitor bash scripts/setup_gcp.sh
   ```
   Dit maakt een service account met alleen leesrecht op de vijf brontabellen en schrijfrecht op de eigen dataset, plus een Workload Identity-provider die alleen deze repository vertrouwt. Geen rechten? Stuur het commando naar de beheerder van Follo's Google Cloud.
3. GitHub, Settings, Secrets and variables, Actions:
   * **Secrets**: `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` (Follo-account), `DASHBOARD_PATH` (krijg je van Claude, of `openssl rand -hex 8`).
   * **Variables** (tabblad Variables, niet bij Secrets): `GCP_PROJECT_ID`, `GCP_WIF_PROVIDER`, `GCP_SERVICE_ACCOUNT`, `BQ_DATASET`, `BQ_LOCATION` (de uitvoer van stap 2).
   * Settings, Pages, Source: **GitHub Actions**.
4. Tabblad **Actions** (bovenaan de repository), workflow *Allianz Direct monitor*, **Run workflow**: eerst `smoke`, dan `full`. Na een fix een nieuwe run starten, niet *Re-run jobs* (die gebruikt de oude commit).
5. Claude controleert de aantallen in BigQuery en de live pagina.
6. Follo Tools, New share link: Content type *Iframe embed*, Client access *Password protected*, code:
   ```html
   <iframe src="https://tomharteveld.github.io/allianzdirect-monitor/<DASHBOARD_PATH>/" style="width:100%;height:100vh;border:0"></iframe>
   ```

## Modi (Run workflow)

| Modus | Wat |
|---|---|
| `auto` | Het schema: in even weken AI Mode, daarna altijd het dashboard |
| `full` | AI Mode nu meten en het dashboard bouwen |
| `rebuild` | Alleen het dashboard opnieuw bouwen uit BigQuery (gratis) |
| `smoke` | 3 AI Mode-calls en een testdashboard op synthetische data; niets opgeslagen of gepubliceerd |

## Annotaties toevoegen

De maandelijkse Claude-taak doet dit automatisch. Handmatig kan ook, in BigQuery:

```sql
INSERT INTO `folloagency.allianzdirect_monitor.annotations` (date, type, title, detail, source, url, tabs, added_at, added_by)
VALUES (DATE '2026-11-20', 'change', 'Nieuwe vergelijkingspagina live', 'Korte toelichting', 'Slack #allianz', '', ['google'], CURRENT_TIMESTAMP(), 'tom');
```

`type`: `change` (doorgevoerd), `pr`, `google` of `data` (datatwijfel). `tabs`: `all`, `google`, `aio`, `chatgpt`, `aimode`. De volgende maandag staat hij in het dashboard, of meteen na een `rebuild`.

## Onderhoud

* **Uitgelekte link**: nieuw `DASHBOARD_PATH`, `rebuild` draaien, iframe in Follo Tools aanpassen.
* **Zoekwoorden of clusters wijzigen**: `config/allianzdirect.yaml`. Clusterregels zijn RE2-regex (zonder enkele aanhalingstekens) en gelden voor alle bronnen.
* **Nieuwe FolloEngine-tabel** (bijvoorbeeld een v3-project): pas `sources` in de config aan en geef het service account leesrecht (`GRANT roles/bigquery.dataViewer ON TABLE ...`).
* **Overdracht**: geef een collega schrijfrechten op de repository; secrets blijven in GitHub, de data in BigQuery.
* De job `keepalive` houdt het schema actief (GitHub zet schema's anders na 60 dagen zonder activiteit uit).
* Lokaal testen: `pip install -r requirements.txt && PYTHONPATH=src pytest -q` en `PYTHONPATH=src python -m admon.dashboard --source fixture --out site --path test`.
