#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

VERCEL_ENV_NAME="${VERCEL_ENV_NAME:-VITE_API_BASE_URL}"
VERCEL_TARGET_ENVS="${VERCEL_TARGET_ENVS:-production,development}"
VERCEL_PREVIEW_BRANCH="${VERCEL_PREVIEW_BRANCH:-}"
VERCEL_SCOPE="${VERCEL_SCOPE:-}"
VERCEL_REDEPLOY="${VERCEL_REDEPLOY:-true}"

LAST_URL_FILE="${LAST_URL_FILE:-/tmp/k8s_tunnel_last_url}"
TUNNEL_LOG="${TUNNEL_LOG:-/tmp/cloudflare-tunnel-ctp.log}"

extract_url() {
  if [[ -f "${LAST_URL_FILE}" ]]; then
    local from_cache
    from_cache="$(cat "${LAST_URL_FILE}" 2>/dev/null || true)"
    if [[ -n "${from_cache}" ]]; then
      echo "${from_cache}"
      return 0
    fi
  fi

  if [[ -f "${TUNNEL_LOG}" ]]; then
    local from_log
    from_log="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "${TUNNEL_LOG}" | tail -1 || true)"
    if [[ -n "${from_log}" ]]; then
      echo "${from_log}"
      return 0
    fi
  fi

  return 1
}

if ! command -v vercel >/dev/null 2>&1; then
  echo "[error] vercel CLI not found"
  exit 1
fi

if [[ ! -d "${ROOT_DIR}/.vercel" ]]; then
  echo "[error] project is not linked to Vercel (.vercel missing). Run: vercel link"
  exit 1
fi

API_URL="${1:-}"
if [[ -z "${API_URL}" ]]; then
  API_URL="$(extract_url || true)"
fi

if [[ -z "${API_URL}" ]]; then
  echo "[error] Could not resolve tunnel URL. Pass it explicitly:"
  echo "        scripts/vercel-sync.sh https://<name>.trycloudflare.com"
  exit 1
fi

if [[ "${API_URL}" != https://* ]]; then
  echo "[error] API URL must be https://..."
  exit 1
fi

base_cmd=(vercel)
if [[ -n "${VERCEL_SCOPE}" ]]; then
  base_cmd+=(--scope "${VERCEL_SCOPE}")
fi

IFS=',' read -r -a envs <<<"${VERCEL_TARGET_ENVS}"
for env in "${envs[@]}"; do
  env="${env// /}"
  [[ -z "${env}" ]] && continue

  if [[ "${env}" == "preview" && -z "${VERCEL_PREVIEW_BRANCH}" ]]; then
    echo "[warn] skip preview: set VERCEL_PREVIEW_BRANCH for non-interactive mode"
    continue
  fi

  echo "[run] ${VERCEL_ENV_NAME} -> ${env}"
  if [[ "${env}" == "preview" ]]; then
    "${base_cmd[@]}" env add "${VERCEL_ENV_NAME}" preview "${VERCEL_PREVIEW_BRANCH}" --value "${API_URL}" --yes --force >/dev/null
  else
    "${base_cmd[@]}" env add "${VERCEL_ENV_NAME}" "${env}" --value "${API_URL}" --yes --force >/dev/null
  fi
  echo "[ok] synced ${VERCEL_ENV_NAME} for ${env}"
done

printf '%s' "${API_URL}" >"${LAST_URL_FILE}"

if [[ "${VERCEL_REDEPLOY}" == "true" ]]; then
  echo "[run] redeploy production"
  "${base_cmd[@]}" --prod --yes >/dev/null
  echo "[ok] production redeployed"
fi

echo "[done] ${VERCEL_ENV_NAME}=${API_URL}"
