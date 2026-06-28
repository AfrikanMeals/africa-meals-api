#!/usr/bin/env bash
# Build image Docker africa-meals/api pour déploiement VPS (CentOS, etc.).
#
# Usage :
#   ./scripts/docker-build.sh [tag]
#   ./scripts/docker-build.sh docker --platform linux/amd64
#
# Variables :
#   PACKAGES_DIR   — racine packages (africa-meals-proto, field-selection)
#   BUILD_PLATFORM — ex. linux/amd64 (VPS x86_64 CentOS)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
MONO_ROOT="$(cd "${API_ROOT}/.." && pwd)"
TAG="${1:-docker}"
PLATFORM="${BUILD_PLATFORM:-}"

resolve_packages_dir() {
  local candidate
  for candidate in \
    "${PACKAGES_DIR:-}" \
    "${MONO_ROOT}/packages" \
    "${MONO_ROOT}/africa-meals-project/packages" \
    "/opt/packages" \
    "/opt/africa-meals-project/packages"; do
    [[ -n "${candidate}" && -f "${candidate}/africa-meals-proto/package.json" ]] || continue
    printf '%s\n' "$(cd "${candidate}" && pwd)"
    return 0
  done
  return 1
}

prepare_build_context() {
  local packages_dir="$1"
  local ctx

  if [[ -d "${MONO_ROOT}/packages/africa-meals-proto" && -d "${MONO_ROOT}/africa-meals-api" ]]; then
    printf '%s\n' "${MONO_ROOT}"
    return 0
  fi

  if [[ -d "${MONO_ROOT}/africa-meals-project/packages/africa-meals-proto" \
    && "${API_ROOT}" == "${MONO_ROOT}/africa-meals-api" ]]; then
    ctx="$(mktemp -d)"
    mkdir -p "${ctx}/africa-meals-api" "${ctx}/packages"
    rsync -a --exclude node_modules --exclude dist --exclude .git \
      "${API_ROOT}/" "${ctx}/africa-meals-api/"
    rsync -a "${packages_dir}/africa-meals-field-selection/" "${ctx}/packages/africa-meals-field-selection/"
    rsync -a "${packages_dir}/africa-meals-proto/" "${ctx}/packages/africa-meals-proto/"
    printf '%s\n' "${ctx}"
    return 0
  fi

  echo "Layout monorepo introuvable (packages/africa-meals-proto)." >&2
  echo "  export PACKAGES_DIR=/chemin/vers/packages" >&2
  exit 1
}

PACKAGES_DIR_RESOLVED="$(resolve_packages_dir)" || {
  echo "packages/africa-meals-proto introuvable." >&2
  exit 1
}

BUILD_CTX="$(prepare_build_context "${PACKAGES_DIR_RESOLVED}")"
CLEANUP_CTX=""
if [[ "${BUILD_CTX}" != "${MONO_ROOT}" ]]; then
  CLEANUP_CTX="${BUILD_CTX}"
fi
trap '[[ -n "${CLEANUP_CTX}" ]] && rm -rf "${CLEANUP_CTX}"' EXIT

IMAGE="africa-meals/api:${TAG}"
PLATFORM_ARGS=()
if [[ -n "${PLATFORM}" ]]; then
  PLATFORM_ARGS=(--platform "${PLATFORM}")
fi

echo "Build ${IMAGE}"
echo "  API      : ${API_ROOT}"
echo "  packages : ${PACKAGES_DIR_RESOLVED}"
echo "  context  : ${BUILD_CTX}"
[[ -n "${PLATFORM}" ]] && echo "  platform : ${PLATFORM}"

docker build "${PLATFORM_ARGS[@]}" \
  -f "${API_ROOT}/Dockerfile" \
  -t "${IMAGE}" \
  "${BUILD_CTX}"

echo ""
echo "OK — ${IMAGE}"
echo "  docker compose --env-file .env.docker up -d"
echo "  export image : docker save ${IMAGE} | gzip > africa-meals-api-${TAG}.tar.gz"
