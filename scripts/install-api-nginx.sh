#!/usr/bin/env bash
# nginx reverse-proxy api.wise-eat.cloud → Docker API (127.0.0.1:9000).
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
CERTBOT_WEBROOT="${CERTBOT_WEBROOT:-/var/www/certbot}"

command -v nginx >/dev/null 2>&1 || api_nginx_die "nginx absent — yum install nginx / apt install nginx"
command -v envsubst >/dev/null 2>&1 || api_nginx_die "envsubst absent — yum install gettext"

mkdir -p "${CERTBOT_WEBROOT}/.well-known/acme-challenge"
api_nginx_webroot_chown "${CERTBOT_WEBROOT}"

SITE="$(api_nginx_site_path "${API_WISE_EAT_DOMAIN}")"
export API_WISE_EAT_DOMAIN API_BACKEND_HOST API_BACKEND_PORT CERTBOT_WEBROOT

if api_nginx_cert_exists "${API_WISE_EAT_DOMAIN}"; then
  api_nginx_ensure_tls_snippets
  envsubst '${API_WISE_EAT_DOMAIN} ${API_BACKEND_HOST} ${API_BACKEND_PORT} ${CERTBOT_WEBROOT}' \
    < "${NGINX_SRC}/api.wise-eat.cloud.https.conf.template" > "${SITE}"
  api_nginx_log "HTTPS → http://${API_BACKEND_HOST}:${API_BACKEND_PORT}"
else
  envsubst '${API_WISE_EAT_DOMAIN} ${API_BACKEND_HOST} ${API_BACKEND_PORT} ${CERTBOT_WEBROOT}' \
    < "${NGINX_SRC}/api.wise-eat.cloud.http.conf.template" > "${SITE}"
  api_nginx_log "HTTP (webroot Certbot) → http://${API_BACKEND_HOST}:${API_BACKEND_PORT}"
fi

api_nginx_enable_site "${API_WISE_EAT_DOMAIN}"
api_nginx_reload

api_nginx_log "Actif — ${API_WISE_EAT_DOMAIN} → Docker :${API_BACKEND_PORT}"
api_nginx_log "HTTPS : sudo STUNNEL_TLS_EMAIL=help@wise-eat.com ./scripts/enable-api-nginx-ssl.sh"
