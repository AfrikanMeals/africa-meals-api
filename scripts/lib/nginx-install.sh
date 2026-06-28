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
