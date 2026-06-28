#!/usr/bin/env bash
# Helpers nginx — déploiement Docker API (CentOS / Ubuntu, CWP7).
# SSL terminé par Cloudflare (origine HTTP:80) — pas de Let's Encrypt.
set -euo pipefail

api_nginx_log() { echo "[api-nginx] $*" >&2; }
api_nginx_warn() { echo "[api-nginx] WARN: $*" >&2; }
api_nginx_die() { echo "[api-nginx] ERROR: $*" >&2; exit 1; }

api_nginx_require_root() {
  [[ "${EUID:-$(id -u)}" -eq 0 ]] || api_nginx_die "Exécuter en root (sudo)"
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

api_nginx_vhost_search_dirs() {
  local d
  for d in \
    /etc/nginx/conf.d/vhosts \
    /etc/nginx/vhosts \
    /usr/local/nginx/conf/vhosts \
    /etc/nginx/conf.d; do
    [[ -d "${d}" ]] && printf '%s\n' "${d}"
  done
}

api_nginx_is_ssl_vhost_path() {
  [[ "${1}" =~ (_ssl|\.ssl\.|cloudflare-ssl-off|zz-wise-eat-api) ]]
}

# Fichier nginx qui sert déjà server_name <domain> en HTTP (hors zz / SSL).
api_nginx_find_vhost_http() {
  local domain="${1:?domain}"
  local d f found=""

  for d in $(api_nginx_vhost_search_dirs); do
    for f in \
      "${d}/${domain}.conf" \
      "${d}/${domain}.vhost" \
      "${d}/${domain//./_}.conf"; do
      if [[ -f "${f}" ]] && ! api_nginx_is_ssl_vhost_path "${f}"; then
        printf '%s\n' "${f}"
        return 0
      fi
    done
  done

  for d in $(api_nginx_vhost_search_dirs); do
    while IFS= read -r f; do
      [[ -z "${f}" ]] && continue
      api_nginx_is_ssl_vhost_path "${f}" && continue
      if grep -qE "server_name[^;]*\\b${domain}\\b" "${f}" 2>/dev/null; then
        found="${f}"
        break
      fi
    done < <(grep -rl "server_name" "${d}" 2>/dev/null || true)
    [[ -n "${found}" ]] && break
  done

  if [[ -n "${found}" ]]; then
    printf '%s\n' "${found}"
    return 0
  fi
  return 1
}

api_nginx_find_vhost_ssl() {
  local domain="${1:?domain}"
  local d f

  for d in $(api_nginx_vhost_search_dirs); do
    for f in \
      "${d}/${domain}_ssl.conf" \
      "${d}/${domain}.ssl.conf" \
      "${d}/${domain}-ssl.conf"; do
      [[ -f "${f}" ]] && printf '%s\n' "${f}" && return 0
    done
    while IFS= read -r f; do
      [[ -z "${f}" ]] && continue
      if grep -qE "server_name[^;]*\\b${domain}\\b" "${f}" 2>/dev/null \
        && grep -qE 'listen[^;]*443' "${f}" 2>/dev/null; then
        printf '%s\n' "${f}"
        return 0
      fi
    done < <(grep -rl "server_name.*${domain}" "${d}" 2>/dev/null || true)
  done
  return 1
}

api_nginx_cwp_default_vhost_path() {
  local domain="${1:?domain}"
  printf '%s\n' "/etc/nginx/conf.d/vhosts/${domain}.conf"
}

api_nginx_remove_zz_conf() {
  local domain="$1"
  rm -f "/etc/nginx/conf.d/zz-wise-eat-api-${domain}.conf"
}

api_nginx_disable_ssl_vhost() {
  local ssl_file="$1"
  local disabled

  [[ -n "${ssl_file}" && -f "${ssl_file}" ]] || return 0
  disabled="${ssl_file}.wise-eat-cloudflare-ssl-off"
  if [[ -f "${disabled}" ]]; then
    api_nginx_log "Vhost SSL déjà désactivé : ${disabled}"
    return 0
  fi
  mv "${ssl_file}" "${disabled}"
  api_nginx_log "Vhost SSL désactivé (HTTPS Cloudflare) : ${disabled}"
}

api_nginx_write_http_vhost() {
  local http_file="$1"
  local ng_src="$2"
  mkdir -p "$(dirname "${http_file}")"
  envsubst '${API_WISE_EAT_DOMAIN} ${API_BACKEND_HOST} ${API_BACKEND_PORT} ${NGINX_LISTEN_IP}' \
    < "${ng_src}/cwp-api-proxy.http.conf.template" > "${http_file}"
}

api_nginx_patch_vhost() {
  local domain="$1"
  local ng_src="$2"
  local http_file ssl_file backup_dir

  api_nginx_remove_zz_conf "${domain}"

  if http_file="$(api_nginx_find_vhost_http "${domain}" 2>/dev/null)"; then
    api_nginx_log "Vhost existant trouvé : ${http_file}"
  else
    http_file="$(api_nginx_cwp_default_vhost_path "${domain}")"
    api_nginx_log "Création vhost : ${http_file}"
  fi

  backup_dir="/root/wise-eat/nginx-backups/$(date +%Y%m%d%H%M%S)"
  mkdir -p "${backup_dir}"
  [[ -f "${http_file}" ]] && cp -a "${http_file}" "${backup_dir}/"

  if ssl_file="$(api_nginx_find_vhost_ssl "${domain}" 2>/dev/null || true)"; then
    cp -a "${ssl_file}" "${backup_dir}/" 2>/dev/null || true
    api_nginx_disable_ssl_vhost "${ssl_file}"
  fi

  api_nginx_write_http_vhost "${http_file}" "${ng_src}"
  api_nginx_log "Vhost HTTP patché : ${http_file} (backup ${backup_dir})"
  printf '%s\n' "${http_file}"
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
}

api_nginx_verify_domain_proxy() {
  local domain="$1"
  local backend_port="${2:-9000}"
  local cfg

  cfg="$(nginx -T 2>/dev/null | grep -A25 "server_name.*${domain}" | head -30 || true)"
  if grep -q 'public_html\|HTTP Test Page\|autossl_tmp.*location /[^.]' <<< "${cfg}" \
    && ! grep -q "proxy_pass.*:${backend_port}" <<< "${cfg}"; then
    api_nginx_warn "Le vhost ${domain} sert encore public_html CWP — patch non appliqué"
    api_nginx_warn "Chercher : grep -rl '${domain}' /etc/nginx/conf.d/"
    return 1
  fi
  if grep -q "proxy_pass.*127.0.0.1:${backend_port}" <<< "${cfg}"; then
    api_nginx_log "OK — nginx proxy ${domain} → 127.0.0.1:${backend_port}"
    return 0
  fi
  api_nginx_warn "proxy_pass :${backend_port} absent pour ${domain} dans nginx -T"
  return 1
}
