#!/usr/bin/env bash
# nginx reverse-proxy HTTP api.wise-eat.cloud → Docker API (127.0.0.1:9000).
# SSL terminé par Cloudflare — pas de certificat origine / pas de listen 443.
#
# CWP7 : patch le vhost existant (page test → proxy Docker). Jamais zz-wise-eat-api
#        en doublon (conflit server_name → config ignorée).
#
# Usage :
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

api_nginx_remove_zz_conf "${API_WISE_EAT_DOMAIN}"

if api_nginx_is_cwp7; then
  api_nginx_log "CWP7 — patch vhost ${API_WISE_EAT_DOMAIN} (remplace page test CWP)"
  SITE="$(api_nginx_patch_vhost "${API_WISE_EAT_DOMAIN}" "${NGINX_SRC}")"
else
  SITE="$(api_nginx_site_path "${API_WISE_EAT_DOMAIN}")"
  api_nginx_write_http_vhost "${SITE}" "${NGINX_SRC}"
  api_nginx_enable_site "${API_WISE_EAT_DOMAIN}"
fi

api_nginx_reload

api_nginx_log "Actif — ${API_WISE_EAT_DOMAIN} → http://${API_BACKEND_HOST}:${API_BACKEND_PORT}"
api_nginx_log "Fichier : ${SITE}"
api_nginx_cloudflare_ssl_reminder

api_nginx_verify_domain_proxy "${API_WISE_EAT_DOMAIN}" "${API_BACKEND_PORT}" || true

if curl -sf --max-time 10 "http://${API_BACKEND_HOST}:${API_BACKEND_PORT}/api/health" >/dev/null 2>&1; then
  api_nginx_log "Docker API OK sur :${API_BACKEND_PORT}"
else
  api_nginx_warn "Docker API ne répond pas — attendre le boot puis ./scripts/docker-diagnose-vps.sh"
fi

if curl -sf --max-time 10 -H "Host: ${API_WISE_EAT_DOMAIN}" \
  "http://127.0.0.1/api/health" >/dev/null 2>&1; then
  api_nginx_log "OK — nginx → Docker via Host ${API_WISE_EAT_DOMAIN}"
else
  api_nginx_warn "Test nginx local KO : curl -H 'Host: ${API_WISE_EAT_DOMAIN}' http://127.0.0.1/api/health"
fi
