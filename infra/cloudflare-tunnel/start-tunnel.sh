#!/bin/bash
# ============================================================
# Cart-to-Purchase: Cloudflare Tunnel Launcher
# ============================================================
# Exposes local FastAPI backend to the internet via Cloudflare Tunnel.
# No static IP, no port forwarding, no account needed.
# Tunnel URL changes each time (ephemeral tunnel).
#
# Prerequisites:
#   brew install cloudflared   # macOS
#   # or: curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
#
# Usage:
#   ./start-tunnel.sh [port]
#   Example: ./start-tunnel.sh 8000
# ============================================================

set -euo pipefail

PORT="${1:-8000}"
LOGFILE="/tmp/cloudflare-tunnel-ctp.log"
URLFILE="/tmp/cloudflare-tunnel-ctp-url.txt"
PIDFILE="/tmp/cloudflare-tunnel-ctp.pid"
TUNNEL_URL=""
METRICS_PORT="${CLOUDFLARE_TUNNEL_METRICS_PORT:-53121}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}==========================================${NC}"
echo -e "${GREEN}  Cart-to-Purchase Cloudflare Tunnel${NC}"
echo -e "${GREEN}==========================================${NC}"
echo -e "  Local port: $PORT"
echo -e "  Log file:  $LOGFILE"
echo -e "  URL file:  $URLFILE"
echo -e "  PID file:  $PIDFILE"
echo ""

# ---- Check cloudflared installed ----
if ! command -v cloudflared &>/dev/null; then
    echo -e "${RED}ERROR: cloudflared not found.${NC}"
    echo ""
    echo "Install cloudflared:"
    echo "  macOS: brew install cloudflared"
    echo "  Linux: curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \\"
    echo "         -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared"
    echo ""
    exit 1
fi

echo -e "${GREEN}cloudflared found${NC}"

if [ -f "$PIDFILE" ]; then
    PREV_PID="$(cat "$PIDFILE" 2>/dev/null || true)"
    if [ -n "$PREV_PID" ] && kill -0 "$PREV_PID" 2>/dev/null; then
        echo -e "${YELLOW}Stopping previous tunnel process (PID: $PREV_PID)${NC}"
        kill "$PREV_PID" 2>/dev/null || true
        sleep 1
    fi
    rm -f "$PIDFILE"
fi

pkill -f "cloudflared tunnel --url http://127.0.0.1:$PORT" 2>/dev/null || true
sleep 1

# ---- Check local server ----
if ! curl -s --max-time 3 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    echo -e "${YELLOW}WARNING: No server detected on port $PORT${NC}"
    echo ""
    echo "Start your FastAPI server first:"
    echo "  cd serving_pipeline"
    echo "  conda activate propensity_mlops   # or: source .venv/bin/activate"
    echo "  uvicorn api.main:app --host 127.0.0.1 --port $PORT"
    echo ""
    read -rp "Press ENTER to continue anyway, or Ctrl+C to cancel: "
fi

# ---- Start tunnel ----
echo ""
echo -e "${GREEN}Starting Cloudflare Tunnel...${NC}"
echo "Your API will be available at:"
echo -e "  ${YELLOW}https://<random>.trycloudflare.com${NC}"
echo ""
echo "=========================================="
echo ""

# Remove old log
rm -f "$LOGFILE"
rm -f "$URLFILE"

# Start cloudflared tunnel in background
cloudflared tunnel --url "http://127.0.0.1:$PORT" \
    --logfile "$LOGFILE" \
    --metrics "localhost:$METRICS_PORT" \
    --protocol http2 \
    2>&1 &

TUNNEL_PID=$!
echo "$TUNNEL_PID" > "$PIDFILE"

ATTEMPTS=24
for _ in $(seq 1 "$ATTEMPTS"); do
    if [ -f "$LOGFILE" ]; then
        TUNNEL_URL=$(grep -o 'https://[^ "]*.trycloudflare.com' "$LOGFILE" 2>/dev/null | head -1 || true)
    fi

    if [ -n "$TUNNEL_URL" ]; then
        if curl -sS --max-time 4 "$TUNNEL_URL/health" >/dev/null 2>&1; then
            break
        fi
    fi

    sleep 2
done

# ---- Display results ----
if [ -n "$TUNNEL_URL" ]; then
    echo ""
    echo -e "${GREEN}==========================================${NC}"
    echo -e "${GREEN}  TUNNEL ACTIVE!${NC}"
    echo -e "${GREEN}==========================================${NC}"
    echo -e "  API URL: ${YELLOW}$TUNNEL_URL${NC}"
    echo ""
    echo "Test your API:"
    echo "  curl $TUNNEL_URL/predict/stats"
    echo ""
    echo "For local frontend development:"
    echo "  echo \"VITE_API_BASE_URL=$TUNNEL_URL\" > serving_pipeline/react-ui/.env.local"
    echo ""
    echo "For Vercel deployment:"
    echo "  vercel env add VITE_API_BASE_URL"
    echo "  # Enter: $TUNNEL_URL"
    echo ""
    echo "=========================================="
    echo ""
    echo -e "Press ${RED}Ctrl+C${NC} to stop the tunnel"
    echo ""

    # Write URL to convenient file
    echo "$TUNNEL_URL" > "$URLFILE"
    echo "Tunnel URL saved to $URLFILE"
else
    echo -e "${YELLOW}Could not obtain a reachable tunnel URL. Check $LOGFILE${NC}"
    echo "Common fixes:"
    echo "  1) Restart network/VPN"
    echo "  2) Re-run this script to rotate URL"
    echo "  3) Use named tunnel for stable production URL"
fi

# ---- Wait for tunnel process ----
echo "Tunnel PID: $TUNNEL_PID"
trap "echo 'Stopping tunnel...'; kill $TUNNEL_PID 2>/dev/null || true; rm -f '$PIDFILE'; exit 0" INT TERM
wait $TUNNEL_PID
