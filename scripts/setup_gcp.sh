#!/usr/bin/env bash
# One-time keyless Google Cloud setup for the GitHub Actions of this repository.
# Run in Cloud Shell: PROJECT_ID=folloagency GITHUB_REPO=tomharteveld/allianzdirect-monitor bash scripts/setup_gcp.sh
set -euo pipefail
: "${PROJECT_ID:?}"; : "${GITHUB_REPO:?owner/repo}"
REPO_NAME="${GITHUB_REPO#*/}"
SA_NAME="${SA_NAME:-${REPO_NAME:0:30}}"
POOL="${POOL:-github}"
PROVIDER="${PROVIDER:-gh-${REPO_NAME:0:29}}"
DATASET="${BQ_DATASET:-${REPO_NAME//-/_}}"; LOCATION="${BQ_LOCATION:-EU}"
# read-only access to exactly these source tables (FolloEngine + Windsor Search Console export)
SOURCE_TABLES=(
  google_search_reporting.allianz_direct_nl_v2_serp_full_follo
  google_search_reporting.allianz_direct_nl_v2_ai_overviews_follo
  llm_reporting_tables.allianz_direct_nl_v2_llm_combined_canonical
  gsc_queries.allianzdirect
  gsc_page_queries.allianzdirect
)
gcloud config set project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
SA="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"; OWNER="${GITHUB_REPO%%/*}"
# new service accounts take seconds to propagate in IAM: always retry
retry() { local n=0; until "$@"; do n=$((n+1)); [ $n -ge 12 ] && return 1; echo "  wachten op Google IAM ($n/12)..."; sleep 10; done; }
gcloud services enable bigquery.googleapis.com iamcredentials.googleapis.com sts.googleapis.com iam.googleapis.com
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 || gcloud iam service-accounts create "$SA_NAME" --display-name "$REPO_NAME (GitHub Actions)"
retry gcloud iam service-accounts describe "$SA" >/dev/null 2>&1
# bq asks an interactive first-run question in Cloud Shell: always use --headless, never hide prompts
bq --headless --location="$LOCATION" show "$PROJECT_ID:$DATASET" >/dev/null 2>&1 || bq --headless --location="$LOCATION" mk --dataset "$PROJECT_ID:$DATASET"
retry gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$SA" --role roles/bigquery.jobUser --condition=None >/dev/null
retry bq --headless --project_id="$PROJECT_ID" query --nouse_legacy_sql --quiet "GRANT \`roles/bigquery.dataEditor\` ON SCHEMA \`${PROJECT_ID}.${DATASET}\` TO 'serviceAccount:${SA}'" >/dev/null
for t in "${SOURCE_TABLES[@]}"; do
  # tables only (a view would need its underlying tables too); errors are printed, not retried forever
  if out=$(bq --headless --project_id="$PROJECT_ID" query --nouse_legacy_sql --quiet "GRANT \`roles/bigquery.dataViewer\` ON TABLE \`${PROJECT_ID}.${t}\` TO 'serviceAccount:${SA}'" 2>&1); then
    echo "  leesrecht op $t"
  else
    echo "  LET OP: leesrecht op $t mislukt: $out"
  fi
done
gcloud iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1 || gcloud iam workload-identity-pools create "$POOL" --location=global --display-name "GitHub Actions"
# one provider per repository; the condition trusts exactly this repository
gcloud iam workload-identity-pools providers describe "$PROVIDER" --location=global --workload-identity-pool="$POOL" >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --location=global --workload-identity-pool="$POOL" \
    --display-name "$REPO_NAME" --issuer-uri "https://token.actions.githubusercontent.com" \
    --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
    --attribute-condition "assertion.repository == '${GITHUB_REPO}' && assertion.repository_owner == '${OWNER}'"
retry gcloud iam service-accounts add-iam-policy-binding "$SA" --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${GITHUB_REPO}" >/dev/null
echo
echo "Zet deze waarden in GitHub, Settings, Secrets and variables, Actions, tabblad Variables:"
echo "GCP_PROJECT_ID=$PROJECT_ID"
echo "GCP_WIF_PROVIDER=projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"
echo "GCP_SERVICE_ACCOUNT=$SA"; echo "BQ_DATASET=$DATASET"; echo "BQ_LOCATION=$LOCATION"
