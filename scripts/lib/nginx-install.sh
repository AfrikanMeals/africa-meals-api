#!/usr/bin/env bash
# Helpers nginx — déploiement Docker API (CentOS / Ubuntu, CWP7).
# SSL terminé par Cloudflare (origine HTTP:80) — pas de Let's Encrypt.
set -euo pipefail

api_nginx_log() { echo "[api-nginx] $*"; }
api_nginx_warn() { echo "[api-nginx] WARN: $*" >&2; }
api_nginx_die() { echo "[api-nginx] ERROR: $*" >&2; exit 1; }

api_nginx_require_root() {
  [[ "${EUID:-$(id -u)}" -eq 0 ]] || api_nginx_die "Exécuter en root (sudo)"
}

api_nginx_site_path() {
  local domain="${1:?domain}"
  if [[ -d /usr/local/cwpsrv ]]; then
    echo "/etc/nginx/conf.d/zz-wise-eat-api-${domain}.conf"
    return
  fi
  if [[ -d /etc/nginx/sites-available ]]; then
    echo "/etc/nginx/sites-available/${domain}.conf"
  else
    echo "/etc/nginx/conf.d/${domain}.conf"
  fi
}

api_nginx_is_cwp7() {
  [[ -d /usr/local/cwpsrv ]]
}

api_nginx_listen_ip() {
  if [[ -n "${NGINX_LISTEN_IP:-}" ]]; then
    printf '%s\n' "${NGINX_LISTEN_IP}"
    return
  fi
  api_nginx_public_ipv4
}

api_nginx_cwp_reload() {
  if [[ -x /scripts/cwp_api ]]; then
    /scripts/cwp_api webservers rebuild_nginx 2>/dev/null || true
  fi
  api_nginx_reload
}

api_nginx_cwp_vhost_http() {
  local domain="${1:?domain}"
  local dir="/etc/nginx/conf.d/vhosts"
  if [[ -f "${dir}/${domain}.conf" ]]; then
    printf '%s\n' "${dir}/${domain}.conf"
    return 0
  fi
  return 1
}

api_nginx_cwp_vhost_ssl() {
  local domain="${1:?domain}"
  local dir="/etc/nginx/conf.d/vhosts"
  local f
  for f in "${domain}_ssl.conf" "${domain}.ssl.conf"; do
    if [[ -f "${dir}/${f}" ]]; then
      printf '%s\n' "${dir}/${f}"
      return 0
    fi
  done
  return 1
}

api_nginx_cwp_has_domain() {
  api_nginx_cwp_vhost_http "${1}" >/dev/null 2>&1 \
    || grep -rq "server_name.*${1}" /etc/nginx/conf.d/vhosts/ 2>/dev/null
}

api_nginx_remove_zz_conf() {
  local domain="$1"
  rm -f "/etc/nginx/conf.d/zz-wise-eat-api-${domain}.conf"
}

api_nginx_disable_cwp_ssl_vhost() {
  local domain="$1"
  local ssl_file disabled

  ssl_file="$(api_nginx_cwp_vhost_ssl "${domain}" 2>/dev/null || true)"
  [[ -n "${ssl_file}" ]] || return 0

  disabled="${ssl_file}.wise-eat-cloudflare-ssl-off"
  if [[ -f "${disabled}" ]]; then
    api_nginx_log "Vhost SSL déjà désactivé : ${disabled}"
    return 0
  fi

  mv "${ssl_file}" "${disabled}"
  api_nginx_log "Vhost SSL CWP désactivé (Cloudflare termine HTTPS) : ${disabled}"
}

api_nginx_patch_cwp_vhosts() {
  local domain="$1"
  local ng_src="$2"
  local http_file backup_dir

  http_file="$(api_nginx_cwp_vhost_http "${domain}")"
  backup_dir="/root/wise-eat/nginx-backups/$(date +%Y%m%d%H%M%S)"
  mkdir -p "${backup_dir}"

  cp -a "${http_file}" "${backup_dir}/" 2>/dev/null || true
  if ssl_file="$(api_nginx_cwp_vhost_ssl "${domain}" 2>/dev/null || true)"; then
    cp -a "${ssl_file}" "${backup_dir}/" 2>/dev/null || true
  fi

  api_nginx_remove_zz_conf "${domain}"
  api_nginx_disable_cwp_ssl_vhost "${domain}"

  envsubst '${API_WISE_EAT_DOMAIN} ${API_BACKEND_HOST} ${API_BACKEND_PORT} ${NGINX_LISTEN_IP}' \
    < "${ng_src}/cwp-api-proxy.http.conf.template" > "${http_file}"
  api_nginx_log "CWP vhost HTTP patché : ${http_file} (backup ${backup_dir})"

  touch "/root/wise-eat/.cwp-api-proxy-${domain}"
}

api_nginx_enable_site() {
  local domain="$1"
  local site
  site="$(api_nginx_site_path "${domain}")"
  if [[ -d /etc/nginx/sites-enabled ]]; then
    ln -sf "${site}" "/etc/nginx/sites-enabled/${domain}.conf"
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

api_nginx_cloudflare_ssl_reminder() {
  api_nginx_log "Cloudflare → SSL/TLS → mode **Flexible** (HTTPS client ↔ CF, HTTP CF ↔ origine :80)"
  api_nginx_log "Éviter Full (strict) sans cert origine — sinon erreur 526"
}
