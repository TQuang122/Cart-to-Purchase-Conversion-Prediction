# Scripts Operations Guide

Operational helpers for local K8s + Cloudflare tunnel + Vercel sync.

## Available Scripts

- `k8s-tunnel.sh`
  - Manages `kubectl port-forward` + `cloudflared`.
  - Commands: `start | stop | restart | status | logs | sync-vercel`.

- `vercel-sync.sh`
  - Syncs `VITE_API_BASE_URL` to Vercel envs.
  - Optional production redeploy.

- `smoke-check.sh`
  - Checks local and public health/stats endpoints.
  - Optional chat endpoint check.

- `pre-shutdown.sh`
  - Runs `infra/k8s/backup.sh` and verifies backup freshness.

- `open-prod-with-api.sh`
  - Opens production frontend URL with `?api=<current_tunnel_url>`.

## Quick Start

```bash
chmod +x scripts/*.sh

# Start tunnel stack
scripts/k8s-tunnel.sh start

# Check runtime state
scripts/k8s-tunnel.sh status

# Smoke check local+tunnel endpoints
scripts/smoke-check.sh

# Open production with API override
scripts/open-prod-with-api.sh
```

## Auto Sync Vercel On Tunnel Restart

```bash
AUTO_UPDATE_VERCEL=true \
VERCEL_TARGET_ENVS=production,development \
VERCEL_REDEPLOY=true \
scripts/k8s-tunnel.sh restart
```

Notes:
- `preview` env requires branch name to avoid interactive prompt.
- Default sync target is `production`.

## Manual Vercel Sync

```bash
# Use current tunnel URL from logs/cache
VERCEL_TARGET_ENVS=production,development scripts/vercel-sync.sh

# Or pass URL explicitly
scripts/vercel-sync.sh https://<name>.trycloudflare.com
```

Useful env vars:
- `VERCEL_ENV_NAME` (default: `VITE_API_BASE_URL`)
- `VERCEL_TARGET_ENVS` (default: `production,development`)
- `VERCEL_SCOPE` (optional Vercel team scope)
- `VERCEL_REDEPLOY` (`true|false`)

## Safe Shutdown Flow

```bash
# Backup + freshness verify
scripts/pre-shutdown.sh

# Then stop tunnel and port-forward
scripts/k8s-tunnel.sh stop
```

## Troubleshooting

- `ERR_NAME_NOT_RESOLVED`:
  - Tunnel URL expired. Run `scripts/k8s-tunnel.sh restart`.

- Vercel still calling old URL:
  - Run `scripts/vercel-sync.sh` then redeploy.
  - For browser override cache: remove `ctp_api_root_override` from localStorage.

- `address already in use` on `18000`:
  - Existing port-forward is running. Use `scripts/k8s-tunnel.sh status`.
