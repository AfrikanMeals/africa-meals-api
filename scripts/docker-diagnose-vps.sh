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

echo "=== Port ${HTTP_PORT} ==="
if curl -sf --max-time 5 "http://127.0.0.1:${HTTP_PORT}/api/health" | jq . 2>/dev/null; then
  echo "OK /api/health"
else
  echo "FAIL — API ne répond pas sur 127.0.0.1:${HTTP_PORT}"
  echo "Causes fréquentes : Mongo/Redis TLS (.env.docker), crash au boot, healthcheck trop tôt"
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
if grep -q '^REDIS_IP_FAMILY=6' .env.docker 2>/dev/null; then
  echo ""
  echo "ASTUCE : REDIS_IP_FAMILY=6 force IPv6 — sur VPS sans IPv6, mettre REDIS_IP_FAMILY=4"
  echo "         et DNS_RESULT_ORDER=ipv4first dans .env.docker puis relancer docker-run-vps.sh"
fi
echo ""
if [[ -f .env.docker ]]; then
  grep -nE ' = |^DASHBOARD_CA' .env.docker || echo "(aucune ligne ' = ' suspecte)"
else
  echo ".env.docker absent dans $(pwd)"
fi
