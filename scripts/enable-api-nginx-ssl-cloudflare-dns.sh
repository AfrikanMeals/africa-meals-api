#!/usr/bin/env bash
# Let's Encrypt DNS-01 via Cloudflare (fonctionne avec proxy orange).
#
# Prérequis :
#   - Token API Cloudflare : Zone → DNS → Edit (zone wise-eat.cloud)
#   - pip3 install certbot-dns-cloudflare  (ou python3-certbot-dns-cloudflare)
#
# Usage :
#   export CLOUDFLARE_DNS_TOKEN='...'
#   sudo STUNNEL_TLS_EMAIL=no-reply@wise-eat.cloud ./scripts/enable-api-nginx-ssl-cloudflare-dns.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=lib/nginx-install.sh
source "${SCRIPT_DIR}/lib/nginx-install.sh"

api_nginx_require_root

API_WISE_EAT_DOMAIN="${API_WISE_EAT_DOMAIN:-api.wise-eat.cloud}"

api_nginx_log "=== HTTPS ${API_WISE_EAT_DOMAIN} (DNS-01 Cloudflare) ==="

api_nginx_issue_cert_dns_cloudflare "${API_WISE_EAT_DOMAIN}"

api_nginx_ensure_tls_snippets
"${SCRIPT_DIR}/install-api-nginx.sh"

api_nginx_log "OK — https://${API_WISE_EAT_DOMAIN}/api/health"
api_nginx_log "Cloudflare SSL mode recommandé : Full (strict)"
api_nginx_log "Test : curl -sI https://${API_WISE_EAT_DOMAIN}/api/health | head -5"
