#!/usr/bin/env bash
set -euo pipefail

PROD_URL="${PROD_URL:-https://ctp-conversion-predict.vercel.app}"
LAST_URL_FILE="${LAST_URL_FILE:-/tmp/k8s_tunnel_last_url}"
TUNNEL_LOG="${TUNNEL_LOG:-/tmp/cloudflare-tunnel-ctp.log}"

extract_url() {
  if [[ -f "${LAST_URL_FILE}" ]]; then
    local cached
    cached="$(cat "${LAST_URL_FILE}" 2>/dev/null || true)"
    [[ -n "${cached}" ]] && { echo "${cached}"; return 0; }
  fi

  if [[ -f "${TUNNEL_LOG}" ]]; then
    local from_log
    from_log="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "${TUNNEL_LOG}" | tail -1 || true)"
    [[ -n "${from_log}" ]] && { echo "${from_log}"; return 0; }
  fi

  return 1
}

TUNNEL_URL="${1:-}"
if [[ -z "${TUNNEL_URL}" ]]; then
  TUNNEL_URL="$(extract_url || true)"
fi

if [[ -z "${TUNNEL_URL}" ]]; then
  echo "[error] tunnel URL not found. Pass explicitly:"
  echo "        scripts/open-prod-with-api.sh https://<name>.trycloudflare.com"
  exit 1
fi

TARGET_URL="${PROD_URL}/?api=${TUNNEL_URL}"
echo "[info] opening ${TARGET_URL}"

if command -v open >/dev/null 2>&1; then
  open "${TARGET_URL}"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "${TARGET_URL}" >/dev/null 2>&1 &
else
  echo "[warn] no browser opener found. Open this URL manually:"
  echo "${TARGET_URL}"
fi
