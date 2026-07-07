#!/usr/bin/env bash
# Test e-mail images (Firebase → GCS) vers borissandeu0@gmail.com par défaut.
#
# Usage :
#   ./scripts/test-email-media-images.sh              # envoi SMTP (standalone, sans Mongo)
#   ./scripts/test-email-media-images.sh --dry-run    # aperçu URLs sans envoi
#   ./scripts/test-email-media-images.sh --to=autre@email.com
#   ./scripts/test-email-media-images.sh --nest       # via Nest (MongoDB requis)
#
# Prérequis : .env avec SMTP_USER + SMTP_APP_PASSWORD (docs/MAIL_SETUP.md).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Erreur : .env introuvable dans $ROOT" >&2
  echo "Copiez .env.example et configurez SMTP (docs/MAIL_SETUP.md)." >&2
  exit 1
fi

USE_NEST=false
ARGS=()
for arg in "$@"; do
  if [[ "$arg" == "--nest" ]]; then
    USE_NEST=true
  else
    ARGS+=("$arg")
  fi
done

if [[ "$USE_NEST" == true ]]; then
  echo "→ Mode Nest (résolution via MediasService, MongoDB requis)…"
  if ((${#ARGS[@]})); then
    npm run test:email-media -- "${ARGS[@]}"
  else
    npm run test:email-media
  fi
else
  echo "→ Mode standalone (SMTP direct, sans MongoDB)…"
  if ((${#ARGS[@]})); then
    node scripts/test-email-media-images.mjs "${ARGS[@]}"
  else
    node scripts/test-email-media-images.mjs
  fi
fi
