#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${NAMESPACE:-mlops}"
SERVICE="${SERVICE:-serving-api}"
LOCAL_PORT="${LOCAL_PORT:-18000}"
REMOTE_PORT="${REMOTE_PORT:-8000}"

PF_LOG="${PF_LOG:-/tmp/serving_pf_18000.log}"
TUNNEL_LOG="${TUNNEL_LOG:-/tmp/cloudflare-tunnel-ctp.log}"
TUNNEL_STDOUT="${TUNNEL_STDOUT:-/tmp/cloudflared_stdout.log}"
LAST_URL_FILE="${LAST_URL_FILE:-/tmp/k8s_tunnel_last_url}"

AUTO_UPDATE_VERCEL="${AUTO_UPDATE_VERCEL:-false}"
VERCEL_ENV_NAME="${VERCEL_ENV_NAME:-VITE_API_BASE_URL}"
VERCEL_TARGET_ENVS="${VERCEL_TARGET_ENVS:-production}"
VERCEL_PREVIEW_BRANCH="${VERCEL_PREVIEW_BRANCH:-}"
VERCEL_SCOPE="${VERCEL_SCOPE:-}"
VERCEL_REDEPLOY="${VERCEL_REDEPLOY:-false}"

WATCHDOG_INTERVAL_SECONDS="${WATCHDOG_INTERVAL_SECONDS:-15}"
WATCHDOG_FAILURE_THRESHOLD="${WATCHDOG_FAILURE_THRESHOLD:-2}"
WATCHDOG_CHECK_PUBLIC="${WATCHDOG_CHECK_PUBLIC:-false}"
WATCHDOG_LOG="${WATCHDOG_LOG:-/tmp/k8s-tunnel-watchdog.log}"
WATCHDOG_PID_FILE="${WATCHDOG_PID_FILE:-/tmp/k8s-tunnel-watchdog.pid}"
ENABLE_DESKTOP_NOTIFICATIONS="${ENABLE_DESKTOP_NOTIFICATIONS:-true}"

log_ts() {
  date "+%Y-%m-%d %H:%M:%S"
}

log_watchdog() {
  local level="$1"
  shift
  printf '[%s] [%s] %s\n' "$(log_ts)" "${level}" "$*"
}

notify_desktop() {
  local title="$1"
  local message="$2"
  if [[ "${ENABLE_DESKTOP_NOTIFICATIONS}" != "true" ]]; then
    return 0
  fi
  if [[ "$(uname -s)" != "Darwin" ]]; then
    return 0
  fi
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display notification \"${message}\" with title \"${title}\"" >/dev/null 2>&1 || true
  fi
}

pf_pid() {
  pgrep -f "kubectl port-forward -n ${NAMESPACE} svc/${SERVICE} ${LOCAL_PORT}:${REMOTE_PORT}" || true
}

tunnel_pid() {
  pgrep -f "cloudflared tunnel --url http://127.0.0.1:${LOCAL_PORT}" || true
}

watchdog_pid() {
  if [[ ! -f "${WATCHDOG_PID_FILE}" ]]; then
    return 1
  fi
  local pid
  pid="$(cat "${WATCHDOG_PID_FILE}" 2>/dev/null || true)"
  if [[ -z "${pid}" ]]; then
    return 1
  fi
  if ps -p "${pid}" >/dev/null 2>&1; then
    printf '%s\n' "${pid}"
    return 0
  fi
  return 1
}

extract_url() {
  if [[ -f "${TUNNEL_LOG}" ]]; then
    grep -Eo "https://[a-z0-9-]+\.trycloudflare\.com" "${TUNNEL_LOG}" | tail -1 || true
  fi
}

wait_for_url() {
  local tries="${1:-45}"
  local delay="${2:-1}"
  local url=""
  for _ in $(seq 1 "${tries}"); do
    url="$(extract_url)"
    if [[ -n "${url}" ]]; then
      echo "${url}"
      return 0
    fi
    sleep "${delay}"
  done
  return 1
}

sync_vercel_env() {
  local url="$1"

  if ! command -v vercel >/dev/null 2>&1; then
    echo "[warn] Vercel CLI not found, skip env sync"
    return 0
  fi

  local base_cmd=(vercel)
  if [[ -n "${VERCEL_SCOPE}" ]]; then
    base_cmd+=(--scope "${VERCEL_SCOPE}")
  fi

  IFS=',' read -r -a envs <<<"${VERCEL_TARGET_ENVS}"
  for env in "${envs[@]}"; do
    env="${env// /}"
    if [[ -z "${env}" ]]; then
      continue
    fi

    if [[ "${env}" == "preview" && -z "${VERCEL_PREVIEW_BRANCH}" ]]; then
      echo "[warn] skip preview env sync: set VERCEL_PREVIEW_BRANCH to avoid interactive prompt"
      continue
    fi

    echo "[run] sync ${VERCEL_ENV_NAME} -> ${env}"
    if [[ "${env}" == "preview" ]]; then
      "${base_cmd[@]}" env add "${VERCEL_ENV_NAME}" preview "${VERCEL_PREVIEW_BRANCH}" --value "${url}" --yes --force >/dev/null
    else
      "${base_cmd[@]}" env add "${VERCEL_ENV_NAME}" "${env}" --value "${url}" --yes --force >/dev/null
    fi
    echo "[ok] synced ${VERCEL_ENV_NAME} for ${env}"
  done

  if [[ "${VERCEL_REDEPLOY}" == "true" ]]; then
    echo "[run] triggering production redeploy"
    "${base_cmd[@]}" --prod --yes >/dev/null
    echo "[ok] production redeploy triggered"
  fi
}

maybe_sync_vercel() {
  local url="$1"
  if [[ "${AUTO_UPDATE_VERCEL}" != "true" ]]; then
    return 0
  fi

  local previous=""
  if [[ -f "${LAST_URL_FILE}" ]]; then
    previous="$(cat "${LAST_URL_FILE}" 2>/dev/null || true)"
  fi

  if [[ "${previous}" == "${url}" ]]; then
    echo "[ok] tunnel URL unchanged; skip Vercel env sync"
    return 0
  fi

  sync_vercel_env "${url}"
  printf '%s' "${url}" >"${LAST_URL_FILE}"
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
    local existing_pid
    existing_pid="$(tunnel_pid)"
    echo "[ok] tunnel already running (pid: ${existing_pid})"
    local existing_url
    existing_url="$(extract_url)"
    local existing_ok="true"
    if ! check_local_health; then
      existing_ok="false"
    elif [[ -n "${existing_url}" ]] && ! curl -fsS --max-time 8 "${existing_url}/health" >/dev/null 2>&1; then
      existing_ok="false"
    fi

    if [[ "${existing_ok}" == "true" && -n "${existing_url}" ]]; then
      maybe_sync_vercel "${existing_url}"
      return
    fi

    echo "[warn] existing tunnel unhealthy, restarting..."
    kill "${existing_pid}" >/dev/null 2>&1 || true
    sleep 1
  fi

  echo "[run] starting cloudflared tunnel..."
  : >"${TUNNEL_LOG}"
  : >"${TUNNEL_STDOUT}"
  cloudflared tunnel --url "http://127.0.0.1:${LOCAL_PORT}" --logfile "${TUNNEL_LOG}" --protocol http2 >"${TUNNEL_STDOUT}" 2>&1 &
  local url
  if ! url="$(wait_for_url 60 1)"; then
    echo "[warn] tunnel URL not found yet, check logs: ${TUNNEL_LOG}"
  else
    echo "[ok] tunnel URL: ${url}"
    maybe_sync_vercel "${url}"
  fi
}

check_local_health() {
  curl -fsS --max-time 5 "http://127.0.0.1:${LOCAL_PORT}/health" >/dev/null 2>&1
}

check_public_health() {
  local url
  url="$(extract_url)"
  if [[ -z "${url}" ]]; then
    return 1
  fi
  curl -fsS --max-time 8 "${url}/health" >/dev/null 2>&1
}

watchdog_loop() {
  local failures=0
  local last_url=""
  log_watchdog "INFO" "watchdog started (interval=${WATCHDOG_INTERVAL_SECONDS}s, threshold=${WATCHDOG_FAILURE_THRESHOLD})"

  while true; do
    local pfp
    local tp
    pfp="$(pf_pid || true)"
    tp="$(tunnel_pid || true)"

    local unhealthy_reason=""
    if [[ -z "${pfp}" ]]; then
      unhealthy_reason="port-forward missing"
    elif [[ -z "${tp}" ]]; then
      unhealthy_reason="cloudflared missing"
    elif ! check_local_health; then
      unhealthy_reason="local health check failed"
    elif [[ "${WATCHDOG_CHECK_PUBLIC}" == "true" ]] && ! check_public_health; then
      unhealthy_reason="public health check failed"
    fi

    if [[ -n "${unhealthy_reason}" ]]; then
      failures=$((failures + 1))
      if [[ "${failures}" -eq 1 ]]; then
        log_watchdog "WARN" "instability detected: ${unhealthy_reason} (pre-heal warning)"
        notify_desktop "K8s Tunnel Warning" "Connection unstable: ${unhealthy_reason}. Auto-heal if it persists."
      else
        log_watchdog "WARN" "failure ${failures}/${WATCHDOG_FAILURE_THRESHOLD}: ${unhealthy_reason}"
      fi
    else
      if [[ "${failures}" -gt 0 ]]; then
        log_watchdog "INFO" "health recovered before restart"
      fi
      failures=0
    fi

    if [[ "${failures}" -ge "${WATCHDOG_FAILURE_THRESHOLD}" ]]; then
      log_watchdog "ERROR" "auto-heal triggered (reason: ${unhealthy_reason})"
      notify_desktop "K8s Tunnel Auto-heal" "Restarting port-forward/tunnel due to: ${unhealthy_reason}"
      stop_all
      sleep 1
      start_pf
      start_tunnel
      failures=0
      last_url=""
      log_watchdog "INFO" "auto-heal completed"
    fi

    if [[ "${AUTO_UPDATE_VERCEL}" == "true" ]]; then
      local current_url
      current_url="$(extract_url)"
      if [[ -n "${current_url}" && "${current_url}" != "${last_url}" ]]; then
        log_watchdog "INFO" "tunnel URL changed: ${last_url} -> ${current_url}"
        maybe_sync_vercel "${current_url}"
        last_url="${current_url}"
      fi
    fi

    sleep "${WATCHDOG_INTERVAL_SECONDS}"
  done
}

start_daemon() {
  local existing
  existing="$(watchdog_pid || true)"
  if [[ -n "${existing}" ]]; then
    echo "[ok] watchdog daemon already running (pid: ${existing})"
    return 0
  fi

  nohup "$0" watchdog >>"${WATCHDOG_LOG}" 2>&1 &
  local pid=$!
  printf '%s' "${pid}" >"${WATCHDOG_PID_FILE}"
  echo "[ok] watchdog daemon started (pid: ${pid})"
  echo "[ok] watchdog log: ${WATCHDOG_LOG}"
}

stop_daemon() {
  local pid
  pid="$(watchdog_pid || true)"
  if [[ -z "${pid}" ]]; then
    rm -f "${WATCHDOG_PID_FILE}"
    echo "[ok] watchdog daemon not running"
    return 0
  fi

  kill "${pid}" >/dev/null 2>&1 || true
  rm -f "${WATCHDOG_PID_FILE}"
  echo "[ok] stopped watchdog daemon pid ${pid}"
}

status_daemon() {
  local pid
  pid="$(watchdog_pid || true)"
  if [[ -n "${pid}" ]]; then
    echo "watchdog pid:     ${pid}"
    echo "watchdog log:     ${WATCHDOG_LOG}"
    echo "watchdog interval:${WATCHDOG_INTERVAL_SECONDS}s"
    echo "heal threshold:   ${WATCHDOG_FAILURE_THRESHOLD}"
  else
    echo "watchdog pid:     -"
    echo "watchdog:         stopped"
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
  echo "watchdog pid:     $(watchdog_pid || echo '-')"
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
  echo
  echo "=== watchdog log ==="
  tail -n 60 "${WATCHDOG_LOG}" 2>/dev/null || true
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
  daemon-start)
    start_pf
    start_tunnel
    start_daemon
    status_all
    ;;
  daemon-stop)
    stop_daemon
    ;;
  daemon-status)
    status_all
    ;;
  watchdog)
    watchdog_loop
    ;;
  status)
    status_all
    ;;
  logs)
    logs_all
    ;;
  sync-vercel)
    url="$(extract_url)"
    if [[ -z "${url}" ]]; then
      echo "[error] no tunnel URL found in ${TUNNEL_LOG}"
      exit 1
    fi
    sync_vercel_env "${url}"
    printf '%s' "${url}" >"${LAST_URL_FILE}"
    ;;
  check-url)
    url="$(extract_url)"
    if [[ -z "${url}" ]]; then
      echo "No tunnel URL found"
      exit 1
    fi
    echo "Current URL: ${url}"
    if curl -fsS --max-time 8 "${url}/health" >/dev/null 2>&1; then
      echo "Status: HEALTHY"
    else
      echo "Status: UNHEALTHY"
    fi
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs|sync-vercel|check-url|daemon-start|daemon-stop|daemon-status}"
    echo ""
    echo "Optional env vars:"
    echo "  AUTO_UPDATE_VERCEL=true          # auto sync on start/restart when URL changes"
    echo "  VERCEL_ENV_NAME=VITE_API_BASE_URL"
    echo "  VERCEL_TARGET_ENVS=production    # comma separated, e.g. production,development"
    echo "  VERCEL_PREVIEW_BRANCH=feature-x  # required when VERCEL_TARGET_ENVS includes preview"
    echo "  VERCEL_SCOPE=your-team"
    echo "  VERCEL_REDEPLOY=true             # trigger 'vercel --prod --yes' after env sync"
    echo "  WATCHDOG_INTERVAL_SECONDS=15     # watchdog check frequency"
    echo "  WATCHDOG_FAILURE_THRESHOLD=2     # failures before auto-heal restart"
    echo "  WATCHDOG_CHECK_PUBLIC=false      # true to include tunnel public health in watchdog"
    echo "  ENABLE_DESKTOP_NOTIFICATIONS=true"
    exit 1
    ;;
esac
