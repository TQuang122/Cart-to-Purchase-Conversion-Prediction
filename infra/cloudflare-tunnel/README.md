# Cloudflare Tunnel Setup

Exposes local K8s serving API to the internet via Cloudflare Tunnel — no static IP, no port forwarding, free.

## Quick Start (Recommended)

Use the unified `k8s-tunnel.sh` script in `scripts/`:

```bash
# Start tunnel with auto-sync to Vercel
AUTO_UPDATE_VERCEL=true scripts/k8s-tunnel.sh start

# Or run as daemon (auto-restart + auto-sync on URL change)
AUTO_UPDATE_VERCEL=true scripts/k8s-tunnel.sh daemon-start
```

### Available Commands


| Command | Description |
|---------|-------------|
| `start` | Start port-forward + tunnel |
| `stop`  | Stop all processes |
| `restart` | Restart tunnel |
| `status` | Show current status + health |
| `logs` | Show tunnel logs |
| `check-url` | Show current URL + health |
| `sync-vercel` | Manually sync URL to Vercel |
| `daemon-start` | Start watchdog daemon |
| `daemon-stop` | Stop watchdog daemon |
| `daemon-status` | Show daemon status |

### Environment Variables

```bash
# Auto-sync tunnel URL to Vercel on change
AUTO_UPDATE_VERCEL=true

# Which Vercel environments to update
VERCEL_TARGET_ENVS=production,development

# Trigger production redeploy after sync
VERCEL_REDEPLOY=true

# Watchdog settings
WATCHDOG_INTERVAL_SECONDS=15    # Check frequency
WATCHDOG_FAILURE_THRESHOLD=2    # Failures before auto-heal
WATCHDOG_CHECK_PUBLIC=false     # Check public health
```

## How It Works

```
Vercel (Frontend) ── HTTPS ──→ Cloudflare CDN ──→ cloudflared ──→ K8s port-forward ──→ serving-api
                                                                                    ↑
                                                                              localhost:18000
```

- **Ephemeral URL**: `https://*.trycloudflare.com` (changes on restart)
- **Auto-sync**: Detects URL changes and updates Vercel env automatically
- **Watchdog**: Monitors health and auto-restarts if tunnel fails

## Production Frontend (Vercel)

The production frontend is configured to **only** use `VITE_API_BASE_URL` from environment variables — localStorage overrides are ignored in production. This prevents stale tunnel URLs from breaking the app.

### Setup

1. Set `VITE_API_BASE_URL` in Vercel Project Settings → Environment Variables:
   ```
   VITE_API_BASE_URL=https://your-tunnel-url.trycloudflare.com
   ```

2. Deploy frontend:
   ```bash
   cd serving_pipeline/react-ui
   vercel --prod
   ```

3. Start tunnel with auto-sync:
   ```bash
   AUTO_UPDATE_VERCEL=true VERCEL_TARGET_ENVS=production scripts/k8s-tunnel.sh start
   ```

## Troubleshooting

**"ERR_NAME_NOT_RESOLVED"**
- Tunnel URL expired. Run `scripts/k8s-tunnel.sh restart`

**"No CORS headers"**
- Backend CORS is correct. This error usually means the tunnel URL is stale/dead
- Check: `scripts/k8s-tunnel.sh check-url`

**Vercel shows old URL errors**
- Run: `scripts/k8s-tunnel.sh sync-vercel`
- Then redeploy in Vercel dashboard

**Frontend works locally but fails in production**
- Verify `VITE_API_BASE_URL` is set in Vercel env vars
- Check browser DevTools → Network tab to see which URL is being called

## API Endpoints

Once tunnel is active:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/predict/stats` | Model stats |
| POST | `/predict/raw-lite` | Predict (13 features) |
| POST | `/predict/raw` | Predict (26 features) |
| POST | `/predict/feast` | Predict by user_id + product_id |
| POST | `/predict/raw/batch` | Batch predict |
| GET | `/dataset/profile` | Dataset profile |
| GET | `/model/overview` | Model metadata |

## Architecture

```
┌────────────────────────────────────────────────┐
│  Vercel (Frontend)  │  Local Dev (npm run dev) │
└──────────┬──────────┴──────────┬───────────────┘
           │                     │
           │ HTTPS               │ HTTP
           ▼                     ▼
    ┌──────────────┐      ┌──────────────┐
    │ Cloudflare   │      │ 127.0.0.1    │
    │ CDN + Tunnel │      │ :18000       │
    └──────┬───────┘      └──────┬───────┘
           │                      │
           │              ┌───────▼───────┐
           │              │ kubectl       │
           │              │ port-forward  │
           │              └──────┬────────┘
           │                     │
           └───────────► ────────▼────────
                              │
                       ┌──────▼──────┐
                       │ serving-api │
                       │ (K8s pod)   │
                       └─────────────┘
```
