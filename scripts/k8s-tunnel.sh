#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${NAMESPACE:-mlops}"
SERVICE="${SERVICE:-serving-api}"
LOCAL_PORT="${LOCAL_PORT:-18000}"
REMOTE_PORT="${REMOTE_PORT:-8000}"

PF_LOG="${PF_LOG:-/tmp/serving_pf_18000.log}"
TUNNEL_LOG="${TUNNEL_LOG:-/tmp/cloudflare-tunnel-ctp.log}"
TUNNEL_STDOUT="${TUNNEL_STDOUT:-/tmp/cloudflared_stdout.log}"

pf_pid() {
  pgrep -f "kubectl port-forward -n ${NAMESPACE} svc/${SERVICE} ${LOCAL_PORT}:${REMOTE_PORT}" || true
}

tunnel_pid() {
  pgrep -f "cloudflared tunnel --url http://127.0.0.1:${LOCAL_PORT}" || true
}

extract_url() {
  if [[ -f "${TUNNEL_LOG}" ]]; then
    grep -Eo "https://[a-z0-9-]+\.trycloudflare\.com" "${TUNNEL_LOG}" | tail -1 || true
  fi
}

start_pf() {
  if [[ -n "$(pf_pid)" ]]; then
    echo "[ok] port-forward already running (pid: $(pf_pid))"
    return
  fi

  echo "[run] starting port-forward ${LOCAL_PORT}->${REMOTE_PORT}..."
  kubectl port-forward -n "${NAMESPACE}" "svc/${SERVICE}" "${LOCAL_PORT}:${REMOTE_PORT}" >"${PF_LOG}" 2>&1 &
  sleep 2
  curl -fsS "http://127.0.0.1:${LOCAL_PORT}/health" >/dev/null
  echo "[ok] port-forward healthy"
}

start_tunnel() {
  if [[ -n "$(tunnel_pid)" ]]; then
    echo "[ok] tunnel already running (pid: $(tunnel_pid))"
    return
  fi

  echo "[run] starting cloudflared tunnel..."
  cloudflared tunnel --url "http://127.0.0.1:${LOCAL_PORT}" --logfile "${TUNNEL_LOG}" --protocol http2 >"${TUNNEL_STDOUT}" 2>&1 &
  sleep 3
  local url
  url="$(extract_url)"
  if [[ -z "${url}" ]]; then
    echo "[warn] tunnel URL not found yet, check logs: ${TUNNEL_LOG}"
  else
    echo "[ok] tunnel URL: ${url}"
  fi
}

stop_all() {
  local p t
  p="$(pf_pid || true)"
  t="$(tunnel_pid || true)"
  if [[ -n "${t}" ]]; then
    kill "${t}" || true
    echo "[ok] stopped tunnel pid ${t}"
  fi
  if [[ -n "${p}" ]]; then
    kill "${p}" || true
    echo "[ok] stopped port-forward pid ${p}"
  fi
}

status_all() {
  echo "=== STATUS ==="
  echo "port-forward pid: $(pf_pid || echo '-')"
  echo "tunnel pid:       $(tunnel_pid || echo '-')"
  echo "tunnel url:       $(extract_url || echo '-')"
  echo "--- health(local) ---"
  curl -sS --max-time 5 "http://127.0.0.1:${LOCAL_PORT}/health" || echo "unreachable"
  local url
  url="$(extract_url)"
  if [[ -n "${url}" ]]; then
    echo "--- health(public) ---"
    curl -sS --max-time 8 "${url}/health" || echo "unreachable"
  fi
}

logs_all() {
  echo "=== port-forward log ==="
  tail -n 60 "${PF_LOG}" 2>/dev/null || true
  echo
  echo "=== tunnel log ==="
  tail -n 60 "${TUNNEL_LOG}" 2>/dev/null || true
}

case "${1:-start}" in
  start)
    start_pf
    start_tunnel
    status_all
    ;;
  stop)
    stop_all
    ;;
  restart)
    stop_all
    sleep 1
    start_pf
    start_tunnel
    status_all
    ;;
  status)
    status_all
    ;;
  logs)
    logs_all
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs}"
    exit 1
    ;;
esac
