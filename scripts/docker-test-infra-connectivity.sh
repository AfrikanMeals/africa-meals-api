#!/usr/bin/env bash
# Teste la connectivité VPS API → infra Wise Eat (Stunnel public).
set -euo pipefail

API_VPS_IP="${API_VPS_IP:-$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)}"

echo "=== Connectivité infra — depuis $(hostname) (${API_VPS_IP:-IP?}) ==="
echo ""

check_tcp() {
  local host="$1" port="$2" label="$3"
  if timeout 5 bash -c "echo >/dev/tcp/${host}/${port}" 2>/dev/null; then
    echo "  OK  ${label} ${host}:${port}"
    return 0
  fi
  echo "  KO  ${label} ${host}:${port} — ECONNREFUSED / timeout / firewall"
  return 1
}

fail=0
for rec in \
  "db.wise-eat.com:27018:MongoDB Stunnel" \
  "cache.wise-eat.com:6381:Redis cache TLS" \
  "cache.wise-eat.com:6382:Redis BullMQ TLS" \
  "broker.wise-eat.com:8883:MQTT TLS"; do
  IFS=: read -r host port label <<< "${rec}"
  check_tcp "${host}" "${port}" "${label}" || fail=1
done

echo ""
echo "=== DNS (doit être DNS only Cloudflare, pas proxy orange) ==="
for host in db.wise-eat.com cache.wise-eat.com broker.wise-eat.com; do
  a="$(dig +short A "${host}" 2>/dev/null | head -1 || true)"
  echo "  ${host} A=${a:-?}"
done

echo ""
if [[ "${fail}" -ne 0 ]]; then
  echo "ACTION — sur le serveur Wise Eat principal (db/cache) :"
  echo "  1. Stunnel actif : ss -tlnp | grep -E '27018|6381|6382'"
  echo "  2. UFW ouvre les ports (A-lite) ou whitelist ${API_VPS_IP:-193.203.169.34}"
  echo "     ufw allow from ${API_VPS_IP:-193.203.169.34} to any port 27018 proto tcp"
  echo "     ufw allow from ${API_VPS_IP:-193.203.169.34} to any port 6381:6386 proto tcp"
  echo "  3. Cloudflare : db.wise-eat.com + cache.wise-eat.com en nuage GRIS (DNS only)"
  exit 1
fi

echo "Infra joignable — relancer : ./scripts/docker-run-vps.sh"
