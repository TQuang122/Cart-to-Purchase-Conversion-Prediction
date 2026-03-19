# Cloudflare Tunnel Setup

Exposes local FastAPI backend to the internet via Cloudflare Tunnel — no static IP, no port forwarding, free. Works without a Cloudflare account.

## Prerequisites

```bash
# Install cloudflared
brew install cloudflared              # macOS
# or: curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
#          -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared
```

## Quick Start

### 1. Start local infrastructure

```bash
# Start MLflow, MinIO, Kafka, Airflow, MySQL
./infra/docker/run.sh up

# Wait ~30s for services to be ready
```

### 2. Start FastAPI backend

```bash
cd serving_pipeline
conda activate propensity_mlops   # or: source .venv/bin/activate
uvicorn api.main:app --host 127.0.0.1 --port 8000
```

You should see:
```
Uvicorn running on http://127.0.0.1:8000
[predict] Loaded xgboost from .../models/xgboost_model.joblib
```

### 3. Start Cloudflare Tunnel

```bash
chmod +x infra/cloudflare-tunnel/start-tunnel.sh
./infra/cloudflare-tunnel/start-tunnel.sh 8000
```

After ~10 seconds, you'll see:
```
TUNNEL ACTIVE!
API URL: https://abc123.trycloudflare.com
```

### 4. Use the tunnel URL

**For local frontend development:**

```bash
cd serving_pipeline/react-ui
echo "VITE_API_BASE_URL=https://abc123.trycloudflare.com" > .env.local
npm run dev
```

**For Vercel deployment:**

```bash
cd serving_pipeline/react-ui
vercel env add VITE_API_BASE_URL
# Enter: https://abc123.trycloudflare.com
vercel --prod
```

## How It Works

```
Browser ←── HTTPS ──→ Cloudflare CDN ←──→ cloudflared tunnel ←──→ localhost:8000 (FastAPI)
                                       ↑
                                   Your machine
```

- Cloudflare handles HTTPS (automatic, free)
- Tunnel URL changes each restart (ephemeral)
- Bandwidth: unlimited, free
- Latency: adds ~50-100ms overhead

## Persistent URL (Optional)

If you want a fixed URL, create a free Cloudflare account:

1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com)
2. Download `cloudflared` and authenticate:
   ```bash
   cloudflared tunnel login
   ```
3. Create a named tunnel:
   ```bash
   cloudflared tunnel create ctp-api
   ```
4. Run the tunnel:
   ```bash
   cloudflared tunnel run ctp-api --url http://localhost:8000
   ```
5. Create DNS CNAME record: `api.yourdomain.com` → `ctp-api.cftr.io`

## API Endpoints

Once tunnel is active, these are available:

| Method | Endpoint                          | Description                        |
|--------|----------------------------------|------------------------------------|
| GET    | `/health`                         | Health check                       |
| GET    | `/predict/stats`                  | Model stats & health               |
| POST   | `/predict/raw-lite`               | Predict with 13 features           |
| POST   | `/predict/raw`                    | Predict with 26 features (full)    |
| POST   | `/predict/feast`                 | Predict by user_id + product_id    |
| POST   | `/predict/raw/batch`             | Batch predict (JSON array)         |
| POST   | `/predict/raw/batch/upload`      | Batch predict (CSV upload)         |
| GET    | `/dataset/stats`                  | Dataset statistics                  |
| GET    | `/dataset/schema`                 | Dataset schema                      |
| GET    | `/model/info`                    | Model metadata                     |

## Troubleshooting

**"Tunnel URL not detected"**
- Wait 15 seconds — tunnel needs time to initialize
- Check `$LOGFILE` (default: `/tmp/cloudflare-tunnel-ctp.log`)

**"Connection refused" on tunnel URL**
- Make sure FastAPI is running on the correct port (default: 8000)
- Check: `curl http://127.0.0.1:8000/health`

**502 Bad Gateway**
- Cloudflare can't reach your local server
- Check firewall: allow outbound port 443

**"cloudflared not found"**
- Install: `brew install cloudflared`
- Verify: `cloudflared --version`

**Frontend shows CORS errors**
- The backend CORS is configured to allow all origins for development
- For production, set `ALLOWED_ORIGINS` env var

## Stopping the Tunnel

```bash
# Press Ctrl+C in the tunnel terminal

# Or kill by PID:
kill $(cat /tmp/cloudflare-tunnel-ctp-url.txt 2>/dev/null || echo "")
```

## Architecture Summary

```
┌─────────────────────────────────────────────────────────┐
│  Vercel (Frontend)  OR  Local Browser (npm run dev)    │
└─────────────────────┬───────────────────────────────────┘
                      │ HTTPS
                      ▼
              Cloudflare CDN (free TLS)
                      │
                      ▼
            cloudflared tunnel
          (cloudflared daemon)
                      │
                      │ localhost
                      ▼
          FastAPI (uvicorn :8000)
          ├── /predict/* — ML model inference
          ├── /dataset/* — dataset info
          └── /model/*   — model metadata
                      │
                      │ localhost
                      ▼
          ┌────────── infrastructure ──────────┐
          │ MLflow (port 5000)               │
          │ MinIO (port 9000/9001)           │
          │ MySQL (port 3306)                │
          │ Kafka (port 9092)                 │
          │ Airflow (port 8090)               │
          └───────────────────────────────────┘
```
