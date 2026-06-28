#!/usr/bin/env bash
# Helpers nginx — déploiement Docker API (CentOS / Ubuntu).
set -euo pipefail

api_nginx_log() { echo "[api-nginx] $*"; }
api_nginx_warn() { echo "[api-nginx] WARN: $*" >&2; }
api_nginx_die() { echo "[api-nginx] ERROR: $*" >&2; exit 1; }

api_nginx_require_root() {
  [[ "${EUID:-$(id -u)}" -eq 0 ]] || api_nginx_die "Exécuter en root (sudo)"
}

api_nginx_site_path() {
  local domain="${1:?domain}"
  if [[ -d /etc/nginx/sites-available ]]; then
    echo "/etc/nginx/sites-available/${domain}.conf"
  else
    echo "/etc/nginx/conf.d/${domain}.conf"
  fi
}

api_nginx_enable_site() {
  local domain="$1"
  local site
  site="$(api_nginx_site_path "${domain}")"
  if [[ -d /etc/nginx/sites-enabled ]]; then
    ln -sf "${site}" "/etc/nginx/sites-enabled/${domain}.conf"
  fi
}

api_nginx_webroot_chown() {
  local webroot="${1:-/var/www/certbot}"
  if id www-data &>/dev/null 2>&1; then
    chown -R www-data:www-data "${webroot}" 2>/dev/null || true
  elif id nginx &>/dev/null 2>&1; then
    chown -R nginx:nginx "${webroot}" 2>/dev/null || true
  fi
}

api_nginx_ensure_tls_snippets() {
  if [[ ! -f /etc/letsencrypt/options-ssl-nginx.conf ]]; then
    mkdir -p /etc/letsencrypt
    curl -fsSL https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf \
      -o /etc/letsencrypt/options-ssl-nginx.conf \
      || api_nginx_warn "options-ssl-nginx.conf absent — certbot install recommandé"
  fi
  if [[ ! -f /etc/letsencrypt/ssl-dhparams.pem ]]; then
    curl -fsSL https://raw.githubusercontent.com/certbot/certbot/master/certbot/certbot/ssl-dhparams.pem \
      -o /etc/letsencrypt/ssl-dhparams.pem \
      || openssl dhparam -out /etc/letsencrypt/ssl-dhparams.pem 2048
  fi
}

api_nginx_cert_exists() {
  local domain="$1"
  [[ -f "/etc/letsencrypt/live/${domain}/fullchain.pem" \
    && -f "/etc/letsencrypt/live/${domain}/privkey.pem" ]]
}

api_nginx_issue_cert() {
  local domain="$1"
  local email="${STUNNEL_TLS_EMAIL:-${CERTBOT_EMAIL:-}}"
  local webroot="${CERTBOT_WEBROOT:-/var/www/certbot}"
  [[ -n "${email}" ]] || api_nginx_die "STUNNEL_TLS_EMAIL ou CERTBOT_EMAIL requis"
  command -v certbot >/dev/null 2>&1 || api_nginx_die "certbot absent — yum install certbot python3-certbot-nginx"

  mkdir -p "${webroot}/.well-known/acme-challenge"
  api_nginx_webroot_chown "${webroot}"

  if api_nginx_cert_exists "${domain}"; then
    certbot certonly --webroot -w "${webroot}" -d "${domain}" \
      --cert-name "${domain}" --email "${email}" --agree-tos --non-interactive \
      --keep-until-expiring --expand
  else
    certbot certonly --webroot -w "${webroot}" -d "${domain}" \
      --cert-name "${domain}" --email "${email}" --agree-tos --non-interactive \
      --keep-until-expiring
  fi
}

api_nginx_reload() {
  nginx -t
  if systemctl is-active nginx >/dev/null 2>&1; then
    systemctl reload nginx
  else
    systemctl enable --now nginx
  fi
}

api_nginx_public_ipv4() {
  curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null \
    || curl -4 -fsS --max-time 5 https://ifconfig.me 2>/dev/null \
    || true
}

api_nginx_dns_a() {
  local domain="$1"
  dig +short A "${domain}" 2>/dev/null | grep -E '^[0-9]+\.' | head -1 || true
}

api_nginx_looks_like_cloudflare_ip() {
  local ip="$1"
  [[ -z "${ip}" ]] && return 1
  [[ "${ip}" =~ ^104\.(1[6-9]|2[0-9]|3[01])\. ]] && return 0
  [[ "${ip}" =~ ^172\.(6[4-9]|7[01])\. ]] && return 0
  [[ "${ip}" =~ ^188\.114\. ]] && return 0
  [[ "${ip}" =~ ^2606:4700: ]] && return 0
  return 1
}

api_nginx_cloudflare_proxy_likely() {
  local domain="$1"
  local resolved vps_ip
  resolved="$(api_nginx_dns_a "${domain}")"
  vps_ip="$(api_nginx_public_ipv4)"
  if api_nginx_looks_like_cloudflare_ip "${resolved}"; then
    return 0
  fi
  [[ -n "${vps_ip}" && -n "${resolved}" && "${resolved}" != "${vps_ip}" ]]
}

api_nginx_acme_local_ok() {
  local domain="$1"
  local webroot="${2:-/var/www/certbot}"
  local token="wise-eat-local-$$"
  mkdir -p "${webroot}/.well-known/acme-challenge"
  echo "${token}" > "${webroot}/.well-known/acme-challenge/${token}"
  api_nginx_webroot_chown "${webroot}"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Host: ${domain}" "http://127.0.0.1/.well-known/acme-challenge/${token}" \
    --max-time 5 2>/dev/null || echo 000)"
  rm -f "${webroot}/.well-known/acme-challenge/${token}"
  [[ "${code}" == "200" ]]
}

api_nginx_acme_public_ok() {
  local domain="$1"
  local webroot="${2:-/var/www/certbot}"
  local token="wise-eat-pub-$$"
  mkdir -p "${webroot}/.well-known/acme-challenge"
  echo "${token}" > "${webroot}/.well-known/acme-challenge/${token}"
  api_nginx_webroot_chown "${webroot}"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' \
    "http://${domain}/.well-known/acme-challenge/${token}" \
    --max-time 15 2>/dev/null || echo 000)"
  rm -f "${webroot}/.well-known/acme-challenge/${token}"
  [[ "${code}" == "200" ]]
}

api_nginx_print_cloudflare_acme_help() {
  local domain="${1:-api.wise-eat.cloud}"
  api_nginx_warn "Certbot HTTP-01 bloqué (souvent Cloudflare proxy orange)."
  cat >&2 <<EOF

Correctifs (choisir un) :

  A) Cloudflare DNS — proxy OFF (nuage gris) pour ${domain}
     Attendre 2–5 min puis :
       STUNNEL_TLS_EMAIL=... ./scripts/enable-api-nginx-ssl.sh

  B) Certbot DNS-01 Cloudflare (proxy orange OK) :
       export CLOUDFLARE_DNS_TOKEN=<token Zone.DNS Edit>
       STUNNEL_TLS_EMAIL=... ./scripts/enable-api-nginx-ssl-cloudflare-dns.sh

  C) Certificat origine Cloudflare (15 ans) → nginx ssl_certificate
     Dashboard Cloudflare → SSL/TLS → Origin Server

VPS IP : $(api_nginx_public_ipv4 || echo '?')
DNS A  : $(api_nginx_dns_a "${domain}" || echo '?')

EOF
}

api_nginx_issue_cert_dns_cloudflare() {
  local domain="$1"
  local email="${STUNNEL_TLS_EMAIL:-${CERTBOT_EMAIL:-}}"
  local creds="${CLOUDFLARE_CREDENTIALS_FILE:-/etc/letsencrypt/cloudflare.ini}"
  [[ -n "${email}" ]] || api_nginx_die "STUNNEL_TLS_EMAIL ou CERTBOT_EMAIL requis"
  [[ -n "${CLOUDFLARE_DNS_TOKEN:-}" ]] || api_nginx_die "CLOUDFLARE_DNS_TOKEN requis (Zone → DNS Edit)"

  command -v certbot >/dev/null 2>&1 || api_nginx_die "certbot absent"
  if ! certbot plugins 2>/dev/null | grep -q dns-cloudflare; then
    api_nginx_log "Installation plugin certbot-dns-cloudflare..."
    pip3 install --quiet certbot-dns-cloudflare 2>/dev/null \
      || yum install -y python3-certbot-dns-cloudflare 2>/dev/null \
      || api_nginx_die "Installer : pip3 install certbot-dns-cloudflare"
  fi

  install -d -m 0700 /etc/letsencrypt
  cat > "${creds}" <<EOF
dns_cloudflare_api_token = ${CLOUDFLARE_DNS_TOKEN}
EOF
  chmod 600 "${creds}"

  certbot certonly --dns-cloudflare \
    --dns-cloudflare-credentials "${creds}" \
    -d "${domain}" \
    --cert-name "${domain}" \
    --email "${email}" \
    --agree-tos \
    --non-interactive \
    --keep-until-expiring
}
