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
# host = pas de port-map Docker (évite RST/502 nginx→127.0.0.1:9000 sur CentOS/CWP)
DOCKER_NETWORK="${DOCKER_NETWORK:-host}"

[[ -f "${ENV_FILE}" ]] || { echo "Fichier absent : ${ENV_FILE}" >&2; exit 1; }

bash "${SCRIPT_DIR}/docker-sanitize-env.sh" "${ENV_FILE}" -o "${RUNTIME_ENV}"

# VPS sans IPv6 sortant : écrase REDIS_IP_FAMILY=6 hérité de .env.functions / ancien pull
if [[ "${VPS_IPV4_ONLY:-1}" == "1" ]]; then
  python3 - "${RUNTIME_ENV}" <<'PY'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
lines = path.read_text(encoding="utf-8").splitlines()
overrides = {
    "REDIS_IP_FAMILY": "4",
    "MONGODB_IP_FAMILY": "4",
    "DNS_RESULT_ORDER": "ipv4first",
}
seen = set()
out = []
for line in lines:
    m = re.match(r"^([^=+#]+)=", line)
    if m and m.group(1).strip() in overrides:
        key = m.group(1).strip()
        out.append(f"{key}={overrides[key]}")
        seen.add(key)
    else:
        out.append(line)
for key, val in overrides.items():
    if key not in seen:
        out.append(f"{key}={val}")
path.write_text("\n".join(out) + "\n", encoding="utf-8")
print("[docker-run-vps] IPv4-only : REDIS_IP_FAMILY=4 MONGODB_IP_FAMILY=4 DNS_RESULT_ORDER=ipv4first")
PY
fi

docker rm -f "${CONTAINER_NAME}" 2>/dev/null || true

RUN_ARGS=(
  -d
  --name "${CONTAINER_NAME}"
  --restart unless-stopped
  --env-file "${RUNTIME_ENV}"
  --add-host "host.docker.internal:host-gateway"
)

if [[ "${DOCKER_NETWORK}" == "host" ]]; then
  RUN_ARGS+=(--network host)
  echo "[docker-run-vps] network=host — API sur 127.0.0.1:${HTTP_PORT} (pas de docker-proxy)"
else
  RUN_ARGS+=(
    -p "127.0.0.1:${HTTP_PORT}:9000"
    -p "127.0.0.1:${GRPC_PORT}:50052"
  )
fi

docker run "${RUN_ARGS[@]}" "${DOCKER_IMAGE}"

echo "OK — ${CONTAINER_NAME} (${DOCKER_IMAGE})"

if ss -tlnp 2>/dev/null | grep -qE ':9000\b'; then
  echo "[docker-run-vps] port 9000 déjà occupé avant boot API :"
  ss -tlnp | grep ':9000' || true
fi

echo "[docker-run-vps] attente /api/health (max 120s)..."
ready=0
for _ in $(seq 1 60); do
  if curl -sf --max-time 3 "http://127.0.0.1:${HTTP_PORT}/api/health" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done

if [[ "${ready}" -eq 1 ]]; then
  echo "[docker-run-vps] API prête — http://127.0.0.1:${HTTP_PORT}/api/health"
  curl -s "http://127.0.0.1:${HTTP_PORT}/api/health" | head -c 200
  echo ""
else
  echo "[docker-run-vps] WARN — API pas prête après 120s" >&2
  echo "  ss -tlnp | grep 9000" >&2
  echo "  docker logs ${CONTAINER_NAME} --tail 40" >&2
fi

echo "  logs : docker logs -f ${CONTAINER_NAME}"
