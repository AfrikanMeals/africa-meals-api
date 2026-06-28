#!/usr/bin/env bash
# nginx reverse-proxy HTTP api.wise-eat.cloud → Docker API (127.0.0.1:9000).
# SSL terminé par Cloudflare — pas de Let's Encrypt / pas de listen 443 sur le VPS.
#
# Cloudflare : SSL/TLS → Flexible (ou Full sans strict si cert origine absent).
#
# Usage :
#   sudo ./scripts/install-api-nginx.sh
#   sudo NGINX_LISTEN_IP=193.203.169.34 ./scripts/install-api-nginx.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
NGINX_SRC="${API_ROOT}/nginx"

# shellcheck source=lib/nginx-install.sh
source "${SCRIPT_DIR}/lib/nginx-install.sh"

api_nginx_require_root

API_WISE_EAT_DOMAIN="${API_WISE_EAT_DOMAIN:-api.wise-eat.cloud}"
API_BACKEND_HOST="${API_BACKEND_HOST:-127.0.0.1}"
API_BACKEND_PORT="${API_BACKEND_PORT:-9000}"
NGINX_LISTEN_IP="${NGINX_LISTEN_IP:-$(api_nginx_listen_ip)}"

[[ -n "${NGINX_LISTEN_IP}" ]] || api_nginx_die "NGINX_LISTEN_IP introuvable — export NGINX_LISTEN_IP=193.203.169.34"

command -v nginx >/dev/null 2>&1 || api_nginx_die "nginx absent"
command -v envsubst >/dev/null 2>&1 || api_nginx_die "envsubst absent — yum install gettext"

export API_WISE_EAT_DOMAIN API_BACKEND_HOST API_BACKEND_PORT NGINX_LISTEN_IP
SUBST_VARS='${API_WISE_EAT_DOMAIN} ${API_BACKEND_HOST} ${API_BACKEND_PORT} ${NGINX_LISTEN_IP}'

if api_nginx_is_cwp7 && api_nginx_cwp_has_domain "${API_WISE_EAT_DOMAIN}"; then
  api_nginx_log "CWP7 — patch vhost HTTP ${API_WISE_EAT_DOMAIN} (SSL Cloudflare, pas LE)"
  api_nginx_patch_cwp_vhosts "${API_WISE_EAT_DOMAIN}" "${NGINX_SRC}"
  SITE="$(api_nginx_cwp_vhost_http "${API_WISE_EAT_DOMAIN}")"
else
  if api_nginx_is_cwp7; then
    api_nginx_log "CWP7 — conf.d/zz-wise-eat-api (pas de vhost CWP existant)"
  fi
  SITE="$(api_nginx_site_path "${API_WISE_EAT_DOMAIN}")"
  envsubst "${SUBST_VARS}" \
    < "${NGINX_SRC}/api.wise-eat.cloud.http.conf.template" > "${SITE}"
  api_nginx_enable_site "${API_WISE_EAT_DOMAIN}"
fi

api_nginx_reload

api_nginx_log "Actif — ${API_WISE_EAT_DOMAIN} → http://${API_BACKEND_HOST}:${API_BACKEND_PORT} (origine HTTP)"
api_nginx_log "Fichier : ${SITE}"
api_nginx_cloudflare_ssl_reminder

if ! curl -sf --max-time 5 "http://${API_BACKEND_HOST}:${API_BACKEND_PORT}/api/health" >/dev/null 2>&1; then
  api_nginx_warn "Docker API ne répond pas sur :${API_BACKEND_PORT} — ./scripts/docker-diagnose-vps.sh"
fi
