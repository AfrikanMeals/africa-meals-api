#!/usr/bin/env bash
# Certificat Let's Encrypt + HTTPS pour api.wise-eat.cloud (Docker :9000).
#
# Prérequis : DNS A/AAAA api.wise-eat.cloud → ce VPS, ports 80/443 ouverts.
#
# Usage :
#   sudo STUNNEL_TLS_EMAIL=help@wise-eat.com ./scripts/enable-api-nginx-ssl.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=lib/nginx-install.sh
source "${SCRIPT_DIR}/lib/nginx-install.sh"

api_nginx_require_root

API_WISE_EAT_DOMAIN="${API_WISE_EAT_DOMAIN:-api.wise-eat.cloud}"

api_nginx_log "=== HTTPS ${API_WISE_EAT_DOMAIN} ==="

"${SCRIPT_DIR}/install-api-nginx.sh"

if ! api_nginx_cert_exists "${API_WISE_EAT_DOMAIN}"; then
  if ! api_nginx_acme_local_ok "${API_WISE_EAT_DOMAIN}"; then
    api_nginx_die "webroot ACME injoignable en local — vérifier nginx + ${CERTBOT_WEBROOT:-/var/www/certbot}"
  fi

  if api_nginx_cloudflare_proxy_likely "${API_WISE_EAT_DOMAIN}" \
    || ! api_nginx_acme_public_ok "${API_WISE_EAT_DOMAIN}"; then
    api_nginx_print_cloudflare_acme_help "${API_WISE_EAT_DOMAIN}"
    api_nginx_die "HTTP-01 impossible — voir options A/B/C ci-dessus"
  fi

  api_nginx_issue_cert "${API_WISE_EAT_DOMAIN}"
fi

api_nginx_ensure_tls_snippets
"${SCRIPT_DIR}/install-api-nginx.sh"

api_nginx_log "OK — https://${API_WISE_EAT_DOMAIN}/api/health"
api_nginx_log "Test : curl -sI https://${API_WISE_EAT_DOMAIN}/api/health | head -5"
