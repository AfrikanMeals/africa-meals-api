#!/usr/bin/env bash
# nginx reverse-proxy api.wise-eat.cloud → Docker API (127.0.0.1:9000).
# Compatible CWP7 Pro (conf.d/zz-wise-eat-api-*.conf + listen IP publique).
#
# Usage :
#   sudo ./scripts/install-api-nginx.sh
#   sudo API_WISE_EAT_DOMAIN=api.wise-eat.cloud API_BACKEND_PORT=9000 ./scripts/install-api-nginx.sh
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
CERTBOT_WEBROOT="${CERTBOT_WEBROOT:-$(api_nginx_default_webroot)}"
NGINX_LISTEN_IP="${NGINX_LISTEN_IP:-$(api_nginx_listen_ip)}"

[[ -n "${NGINX_LISTEN_IP}" ]] || api_nginx_die "NGINX_LISTEN_IP introuvable — export NGINX_LISTEN_IP=193.203.169.34"

command -v nginx >/dev/null 2>&1 || api_nginx_die "nginx absent — yum install nginx / apt install nginx"
command -v envsubst >/dev/null 2>&1 || api_nginx_die "envsubst absent — yum install gettext"

if api_nginx_is_cwp7; then
  api_nginx_log "CWP7 Pro détecté — conf.d/zz-wise-eat-api (non écrasé par rebuild vhosts)"
fi

mkdir -p "${CERTBOT_WEBROOT}/.well-known/acme-challenge"
api_nginx_webroot_chown "${CERTBOT_WEBROOT}"

SITE="$(api_nginx_site_path "${API_WISE_EAT_DOMAIN}")"
export API_WISE_EAT_DOMAIN API_BACKEND_HOST API_BACKEND_PORT CERTBOT_WEBROOT NGINX_LISTEN_IP
SUBST_VARS='${API_WISE_EAT_DOMAIN} ${API_BACKEND_HOST} ${API_BACKEND_PORT} ${CERTBOT_WEBROOT} ${NGINX_LISTEN_IP}'

if api_nginx_cert_exists "${API_WISE_EAT_DOMAIN}"; then
  api_nginx_ensure_tls_snippets
  envsubst "${SUBST_VARS}" \
    < "${NGINX_SRC}/api.wise-eat.cloud.https.conf.template" > "${SITE}"
  api_nginx_log "HTTPS → http://${API_BACKEND_HOST}:${API_BACKEND_PORT} (listen ${NGINX_LISTEN_IP})"
else
  envsubst "${SUBST_VARS}" \
    < "${NGINX_SRC}/api.wise-eat.cloud.http.conf.template" > "${SITE}"
  api_nginx_log "HTTP (webroot ${CERTBOT_WEBROOT}) → http://${API_BACKEND_HOST}:${API_BACKEND_PORT}"
fi

api_nginx_enable_site "${API_WISE_EAT_DOMAIN}"
if api_nginx_is_cwp7; then
  api_nginx_cwp_reload
else
  api_nginx_reload
fi

api_nginx_log "Actif — ${API_WISE_EAT_DOMAIN} → Docker :${API_BACKEND_PORT}"
api_nginx_log "Fichier : ${SITE}"
if ! api_nginx_cert_exists "${API_WISE_EAT_DOMAIN}"; then
  api_nginx_log "HTTPS : sudo STUNNEL_TLS_EMAIL=... ./scripts/enable-api-nginx-ssl-cloudflare-dns.sh"
fi
