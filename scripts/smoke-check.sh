#!/usr/bin/env bash
set -euo pipefail

LOCAL_PORT="${LOCAL_PORT:-18000}"
LAST_URL_FILE="${LAST_URL_FILE:-/tmp/k8s_tunnel_last_url}"
TUNNEL_LOG="${TUNNEL_LOG:-/tmp/cloudflare-tunnel-ctp.log}"
REQUIRE_CHAT="${REQUIRE_CHAT:-false}"

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

check_url() {
  local name="$1"
  local url="$2"
  local timeout="${3:-8}"

  if curl -fsS --max-time "${timeout}" "${url}" >/dev/null; then
    echo "[ok] ${name}: ${url}"
    return 0
  fi
  echo "[fail] ${name}: ${url}"
  return 1
}

check_chat() {
  local base="$1"
  if curl -fsS --max-time 15 -X POST "${base}/chat" -H "Content-Type: application/json" -d '{"message":"hello"}' >/dev/null; then
    echo "[ok] chat endpoint: ${base}/chat"
    return 0
  fi
  echo "[warn] chat endpoint failed: ${base}/chat"
  return 1
}

TUNNEL_URL="${1:-}"
if [[ -z "${TUNNEL_URL}" ]]; then
  TUNNEL_URL="$(extract_url || true)"
fi

echo "=== SMOKE CHECK ==="
echo "local base:  http://127.0.0.1:${LOCAL_PORT}"
echo "tunnel base: ${TUNNEL_URL:-<missing>}"

failed=0
check_url "local health" "http://127.0.0.1:${LOCAL_PORT}/health" 8 || failed=$((failed + 1))
check_url "local stats" "http://127.0.0.1:${LOCAL_PORT}/predict/stats" 12 || failed=$((failed + 1))

if [[ -z "${TUNNEL_URL}" ]]; then
  echo "[fail] tunnel URL not found"
  failed=$((failed + 1))
else
  check_url "public health" "${TUNNEL_URL}/health" 12 || failed=$((failed + 1))
  check_url "public stats" "${TUNNEL_URL}/predict/stats" 15 || failed=$((failed + 1))

  if [[ "${REQUIRE_CHAT}" == "true" ]]; then
    check_chat "${TUNNEL_URL}" || failed=$((failed + 1))
  else
    check_chat "${TUNNEL_URL}" || true
  fi
fi

if [[ "${failed}" -gt 0 ]]; then
  echo "[result] FAILED (${failed})"
  exit 1
fi

echo "[result] PASSED"
