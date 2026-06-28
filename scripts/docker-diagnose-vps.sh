#!/usr/bin/env bash
# Diagnostic Docker API sur VPS (crash loop, health, ports).
set -euo pipefail

CONTAINER="${CONTAINER_NAME:-africa-meals-api}"
HTTP_PORT="${API_HTTP_PORT:-9000}"

echo "=== Docker API — ${CONTAINER} ==="
docker ps -a --filter "name=${CONTAINER}" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
echo ""

echo "=== Derniers logs (80 lignes) ==="
docker logs "${CONTAINER}" --tail 80 2>&1 || true
echo ""

echo "=== Health Docker ==="
docker inspect "${CONTAINER}" --format 'health={{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}} restarts={{.RestartCount}} exit={{.State.ExitCode}}' 2>/dev/null || true
echo ""

echo "=== Port ${HTTP_PORT} (hôte → API) ==="
if curl -sf --max-time 5 "http://127.0.0.1:${HTTP_PORT}/api/health" | jq . 2>/dev/null; then
  echo "OK /api/health via 127.0.0.1:${HTTP_PORT}"
else
  echo "FAIL — curl 127.0.0.1:${HTTP_PORT} (502 nginx si docker-proxy / publish 127.0.0.1 cassé)"
  if docker inspect "${CONTAINER}" >/dev/null 2>&1; then
    net="$(docker inspect "${CONTAINER}" --format '{{.HostConfig.NetworkMode}}' 2>/dev/null || true)"
    echo "  network_mode=${net:-?}"
    if [[ "${net}" != "host" ]]; then
      cip="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "${CONTAINER}" 2>/dev/null || true)"
      if [[ -n "${cip}" ]]; then
        echo "  bridge ${cip}:${HTTP_PORT} → $(curl -sf --max-time 3 "http://${cip}:${HTTP_PORT}/api/health" | head -c 80 || echo FAIL)"
      fi
      echo "  fix : git pull && ./scripts/docker-run-vps.sh  (DOCKER_NETWORK=host par défaut)"
    fi
  fi
fi
echo ""

echo "=== Réseau VPS → infra distante ==="
for host in db.wise-eat.com cache.wise-eat.com ws.wise-eat.com; do
  if timeout 3 bash -c "echo >/dev/tcp/${host}/443" 2>/dev/null; then
    echo "  ${host}:443 OK"
  elif getent ahosts "${host}" >/dev/null 2>&1; then
    echo "  ${host} résolu ($(getent ahosts "${host}" | awk 'NR==1{print $1}'))"
  else
    echo "  ${host} — DNS/réseau KO"
  fi
done
if grep -qE '^REDIS_IP_FAMILY=6' .env.docker 2>/dev/null; then
  echo ""
  echo "WARN : REDIS_IP_FAMILY=6 dans .env.docker — ./scripts/docker-run-vps.sh force IPv4 automatiquement"
fi
if docker inspect "${CONTAINER}" >/dev/null 2>&1; then
  fam="$(docker exec "${CONTAINER}" printenv REDIS_IP_FAMILY 2>/dev/null || true)"
  echo "  conteneur REDIS_IP_FAMILY=${fam:-?}"
fi
echo ""
echo "=== .env.docker (lignes problématiques) ==="
if [[ -f .env.docker ]]; then
  grep -nE ' = |^DASHBOARD_CA' .env.docker || echo "(aucune ligne ' = ' suspecte)"
else
  echo ".env.docker absent dans $(pwd)"
fi
