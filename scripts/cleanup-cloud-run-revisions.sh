#!/usr/bin/env bash
# Supprime les révisions Cloud Run du service **api** qui ne reçoivent plus de trafic.
# Les révisions encore ciblées par le routage (ou la dernière « ready ») sont conservées.
#
# Usage :
#   ./scripts/cleanup-cloud-run-revisions.sh              # dry-run (affiche seulement)
#   ./scripts/cleanup-cloud-run-revisions.sh --execute  # supprime vraiment
#
# Variables optionnelles :
#   PROJECT   (défaut : projet actif gcloud)
#   REGION    (défaut : europe-west1)
#   SERVICE   (défaut : api)
#
# Prérequis : gcloud auth + API Cloud Run, et python3 pour parser le JSON du service.
# Compatible macOS : évite mapfile et ${var,,} (Bash 3.2).

set -euo pipefail

SERVICE="${SERVICE:-api}"
REGION="${REGION:-europe-west1}"
PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
EXECUTE=false

usage() {
  cat <<'EOF'
Usage : cleanup-cloud-run-revisions.sh [--execute] [--service NAME] [--region R] [--project P]

  Par défaut : dry-run. Avec --execute : supprime les révisions sans trafic (après confirmation).

Variables d’environnement : SERVICE, REGION, PROJECT (mêmes défauts que ci-dessus).
EOF
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --execute) EXECUTE=true; shift ;;
    --service)
      SERVICE="${2:?--service requiert un nom}"
      shift 2
      ;;
    --region)
      REGION="${2:?--region requiert une région}"
      shift 2
      ;;
    --project)
      PROJECT="${2:?--project requiert un project id}"
      shift 2
      ;;
    -h | --help) usage 0 ;;
    *)
      echo "Option inconnue : $1" >&2
      usage 1
      ;;
  esac
done

if [[ -z "${PROJECT}" || "${PROJECT}" == "(unset)" ]]; then
  echo "Erreur : aucun projet GCP (gcloud config set project … ou PROJECT=…)." >&2
  exit 1
fi

command -v gcloud >/dev/null || {
  echo "Erreur : gcloud introuvable." >&2
  exit 1
}
command -v python3 >/dev/null || {
  echo "Erreur : python3 requis pour lire le routage du service." >&2
  exit 1
}

# Révisions à ne jamais supprimer (trafic explicite + dernière révision prête)
PROTECTED=()
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" ]] && continue
  PROTECTED+=("$line")
done < <(
  gcloud run services describe "$SERVICE" \
    --project="$PROJECT" \
    --region="$REGION" \
    --format=json |
    python3 -c '
import json, sys
d = json.load(sys.stdin)
st = d.get("status") or {}
names = set()
for t in st.get("traffic") or []:
    rn = t.get("revisionName")
    if rn:
        names.add(rn)
    pct = t.get("percent") or 0
    if t.get("latestRevision") and pct:
        lr = st.get("latestReadyRevisionName")
        if lr:
            names.add(lr)
lr = st.get("latestReadyRevisionName")
if lr:
    names.add(lr)
for n in sorted(names):
    print(n)
'
)

if [[ ${#PROTECTED[@]} -eq 0 ]]; then
  echo "Avertissement : aucune révision protégée détectée (service absent ou JSON inattendu ?). Abandon." >&2
  exit 1
fi

echo "Projet   : $PROJECT"
echo "Région   : $REGION"
echo "Service  : $SERVICE"
echo "Protégées (ne seront pas supprimées) :"
printf '  - %s\n' "${PROTECTED[@]}"
echo

ALL_REVS=()
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" ]] && continue
  ALL_REVS+=("$line")
done < <(
  gcloud run revisions list \
    --project="$PROJECT" \
    --region="$REGION" \
    --service="$SERVICE" \
    --format='value(metadata.name)'
)

to_delete=()
for rev in "${ALL_REVS[@]}"; do
  keep=false
  for p in "${PROTECTED[@]}"; do
    if [[ "$rev" == "$p" ]]; then
      keep=true
      break
    fi
  done
  if [[ "$keep" == false ]]; then
    to_delete+=("$rev")
  fi
done

if [[ ${#to_delete[@]} -eq 0 ]]; then
  echo "Rien à supprimer : une seule famille de révisions actives ou déjà nettoyé."
  exit 0
fi

echo "Révisions sans trafic (candidats à la suppression) : ${#to_delete[@]}"
printf '  - %s\n' "${to_delete[@]}"
echo

if [[ "$EXECUTE" != true ]]; then
  echo "Mode simulation : aucune suppression. Relancez avec --execute pour supprimer."
  exit 0
fi

read -r -p "Supprimer ces ${#to_delete[@]} révisions ? [o/N] " ans
ans_lc=$(printf '%s' "$ans" | tr '[:upper:]' '[:lower:]')
if [[ ! "$ans_lc" =~ ^(o|oui|y|yes)$ ]]; then
  echo "Annulé."
  exit 0
fi

for rev in "${to_delete[@]}"; do
  echo "Suppression de $rev …"
  gcloud run revisions delete "$rev" \
    --project="$PROJECT" \
    --region="$REGION" \
    --quiet
done

echo "Terminé."
