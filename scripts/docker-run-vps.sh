#!/usr/bin/env bash
# Démarre l'API depuis l'image Docker Hub (VPS CentOS).
#
# Usage :
#   ./scripts/docker-run-vps.sh
#   ENV_FILE=.env.docker DOCKER_IMAGE=borix102/africa-meals-api:docker ./scripts/docker-run-vps.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ENV_FILE:-${API_ROOT}/.env.docker}"
RUNTIME_ENV="${RUNTIME_ENV:-${API_ROOT}/.env.docker.runtime}"
DOCKER_IMAGE="${DOCKER_IMAGE:-borix102/africa-meals-api:docker}"
CONTAINER_NAME="${CONTAINER_NAME:-africa-meals-api}"
HTTP_PORT="${API_HTTP_PORT:-9000}"
GRPC_PORT="${GRPC_API_PORT:-50052}"

[[ -f "${ENV_FILE}" ]] || { echo "Fichier absent : ${ENV_FILE}" >&2; exit 1; }

bash "${SCRIPT_DIR}/docker-sanitize-env.sh" "${ENV_FILE}" -o "${RUNTIME_ENV}"

docker rm -f "${CONTAINER_NAME}" 2>/dev/null || true

docker run -d \
  --name "${CONTAINER_NAME}" \
  --restart unless-stopped \
  -p "${HTTP_PORT}:9000" \
  -p "${GRPC_PORT}:50052" \
  --env-file "${RUNTIME_ENV}" \
  --add-host "host.docker.internal:host-gateway" \
  "${DOCKER_IMAGE}"

echo "OK — ${CONTAINER_NAME} (${DOCKER_IMAGE})"
echo "  health : curl -s http://127.0.0.1:${HTTP_PORT}/api/health | jq ."
echo "  logs   : docker logs -f ${CONTAINER_NAME}"
