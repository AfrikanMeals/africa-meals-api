#!/usr/bin/env bash
# Teste la connectivité VPS API → infra Wise Eat (Stunnel public).
set -euo pipefail

API_VPS_IP="${API_VPS_IP:-$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)}"
INFRA_IP="${INFRA_IP:-2.24.207.215}"

echo "=== Connectivité infra — depuis $(hostname) (${API_VPS_IP:-IP?}) ==="
echo ""

check_tcp() {
  local host="$1" port="$2" label="$3"
  local err=""
  if err="$(timeout 5 bash -c "echo >/dev/tcp/${host}/${port}" 2>&1)"; then
    echo "  OK  ${label} ${host}:${port}"
    return 0
  fi
  if grep -qi 'refused' <<< "${err}"; then
    echo "  KO  ${label} ${host}:${port} — REFUSED (port fermé / pare-feu hébergeur / Stunnel down)"
  elif grep -qi 'timed out\|timeout' <<< "${err}"; then
    echo "  KO  ${label} ${host}:${port} — TIMEOUT (firewall DROP)"
  else
    echo "  KO  ${label} ${host}:${port} — ${err:-injoignable}"
  fi
  return 1
}

fail=0

echo "--- Référence : SSH/HTTPS infra (doit passer) ---"
check_tcp "${INFRA_IP}" 443 "HTTPS wise-eat" || true
check_tcp "${INFRA_IP}" 22 "SSH wise-eat" || true
echo ""

echo "--- Stunnel / MQTT (requis pour l'API Docker) ---"
for rec in \
  "db.wise-eat.com:27018:MongoDB Stunnel" \
  "cache.wise-eat.com:6381:Redis cache TLS" \
  "cache.wise-eat.com:6382:Redis BullMQ TLS" \
  "broker.wise-eat.com:8883:MQTT TLS"; do
  IFS=: read -r host port label <<< "${rec}"
  check_tcp "${host}" "${port}" "${label}" || fail=1
done

echo ""
echo "=== DNS (nuage GRIS Cloudflare = DNS only) ==="
for host in db.wise-eat.com cache.wise-eat.com broker.wise-eat.com; do
  a="$(dig +short A "${host}" 2>/dev/null | head -1 || true)"
  echo "  ${host} A=${a:-?}"
done

echo ""
if [[ "${fail}" -ne 0 ]]; then
  cat <<EOF
DIAGNOSTIC
  • Stunnel OK sur wise-eat (ss -tlnp | grep 6381) mais KO ici → pare-feu **hébergeur**
    (panel OVH/Hetzner/Invest-logistic), pas seulement UFW.
  • Cloud Functions fonctionne car l'IP sortante GCP est autorisée — pas ${API_VPS_IP:-ce VPS}.

ACTION serveur Wise Eat (2.24.207.215) :
  sudo API_VPS_IP=${API_VPS_IP:-193.203.169.34} ./scripts/ufw-allow-api-vps.sh
  + panel hébergeur : autoriser INBOUND 27018, 6381-6386, 8883 depuis ${API_VPS_IP:-193.203.169.34}

ACTION panel VPS API (${API_VPS_IP:-?}) :
  autoriser OUTBOUND vers ${INFRA_IP} ports 27018, 6381-6386, 8883

Test manuel :
  nc -zv ${INFRA_IP} 6381
  nc -zv db.wise-eat.com 27018
EOF
  exit 1
fi

echo "Infra joignable — relancer : ./scripts/docker-run-vps.sh"
