#!/usr/bin/env bash
# Met à jour le service Cloud Run **api** : 1 GiB RAM, 2 vCPU, plafond d’instances.
#
# Le quota **CpuAllocPerProjectRegion** (souvent 20 000 mCPU = 20 vCPU) est **partagé par
# tous les services Cloud Run de la région** (api, ws, fonctions Gen2, etc.). Si la somme
# des pics (CPU × max instances) dépasse 20 000, le déploiement échoue encore avec
# « requested: 40000 » (ex. 20 × 2 vCPU quelque part).
#
# Avant la mise à jour, lance le diagnostic (désactive avec SKIP_FOOTPRINT=1) :
#   python3 scripts/cloud-run-regional-cpu-footprint.py
#
# Option utile si **ws** consomme encore trop de marge :
#   CAP_WS_MAX=8 ./scripts/update-cloud-run-api-resources.sh
#
# Plafonds : **`--max`** = limite au niveau **service** (partagée entre révisions en split).
# **`--max-instances`** = limite au niveau **révision**. Sans `--max`, le service peut
# garder un plafond élevé et la validation quota utilise encore ~20 instances × 2 vCPU.
#
# Mise à jour **api** en plusieurs commandes : 1) `--max` + `--max-instances`  2) mémoire
#  3) CPU + rappel des deux plafonds.
#
# Usage :
#   ./scripts/update-cloud-run-api-resources.sh
#   MAX_INSTANCES=4 CAP_WS_MAX=8 ./scripts/update-cloud-run-api-resources.sh
#
set -euo pipefail

SERVICE="${SERVICE:-api}"
WS_SERVICE="${WS_SERVICE:-ws}"
REGION="${REGION:-europe-west1}"
PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
MEMORY="${MEMORY:-1Gi}"
CPU="${CPU:-2}"
MAX_INSTANCES="${MAX_INSTANCES:-4}"
SKIP_FOOTPRINT="${SKIP_FOOTPRINT:-0}"
SLEEP_BETWEEN_STEPS="${SLEEP_BETWEEN_STEPS:-5}"

if [[ -z "$PROJECT" || "$PROJECT" == "(unset)" ]]; then
  echo "Erreur : définis le projet GCP (gcloud config set project … ou PROJECT=…)." >&2
  exit 1
fi

command -v gcloud >/dev/null || {
  echo "Erreur : gcloud introuvable." >&2
  exit 1
}

echo "Mise à jour Cloud Run : service=$SERVICE region=$REGION project=$PROJECT"
echo "  memory=$MEMORY cpu=$CPU max-instances=$MAX_INSTANCES"

if [[ "$SKIP_FOOTPRINT" != "1" ]] && command -v python3 >/dev/null; then
  echo "→ Empreinte CPU régionale (estimation) :"
  python3 "$(dirname "$0")/cloud-run-regional-cpu-footprint.py" "$REGION" "$PROJECT" || true
  echo ""
fi

if [[ -n "${CAP_WS_MAX:-}" ]]; then
  echo "→ Réduction du plafond du service **$WS_SERVICE** (--max + --max-instances)=$CAP_WS_MAX"
  gcloud run services update "$WS_SERVICE" \
    --project="$PROJECT" \
    --region="$REGION" \
    --max="$CAP_WS_MAX" \
    --max-instances="$CAP_WS_MAX"
  echo ""
fi

echo "→ **$SERVICE** — étape 1/3 : plafonds service (--max) + révision (--max-instances), CPU inchangé."
gcloud run services update "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --max="$MAX_INSTANCES" \
  --max-instances="$MAX_INSTANCES"

echo "   (pause ${SLEEP_BETWEEN_STEPS}s pour propagation côté GCP)"
sleep "$SLEEP_BETWEEN_STEPS"

echo "→ **$SERVICE** — étape 2/3 : mémoire (${MEMORY}), CPU inchangé."
gcloud run services update "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --memory="$MEMORY"

echo "→ **$SERVICE** — étape 3/3 : CPU=${CPU} + --max + --max-instances=${MAX_INSTANCES}."
gcloud run services update "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --cpu="$CPU" \
  --max="$MAX_INSTANCES" \
  --max-instances="$MAX_INSTANCES"

echo "OK. URL :"
gcloud run services describe "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --format='value(status.url)'
