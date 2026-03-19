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

set -e

PORT="${1:-8000}"
LOGFILE="/tmp/cloudflare-tunnel-ctp.log"
TUNNEL_URL=""

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

# Start cloudflared tunnel in background
cloudflared tunnel --url "http://127.0.0.1:$PORT" \
    --logfile "$LOGFILE" \
    --metrics "localhost:53121" \
    2>&1 &

TUNNEL_PID=$!

# Wait for tunnel to initialize
sleep 8

# Extract tunnel URL from log
if [ -f "$LOGFILE" ]; then
    TUNNEL_URL=$(grep -o 'https://[^ "]*.trycloudflare.com' "$LOGFILE" 2>/dev/null | head -1)
fi

# Fallback: try again after more time
if [ -z "$TUNNEL_URL" ]; then
    sleep 5
    if [ -f "$LOGFILE" ]; then
        TUNNEL_URL=$(grep -o 'https://[^ "]*.trycloudflare.com' "$LOGFILE" 2>/dev/null | head -1)
    fi
fi

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
    echo "$TUNNEL_URL" > /tmp/cloudflare-tunnel-ctp-url.txt
    echo "Tunnel URL saved to /tmp/cloudflare-tunnel-ctp-url.txt"
else
    echo -e "${YELLOW}Could not detect tunnel URL. Check $LOGFILE${NC}"
fi

# ---- Wait for tunnel process ----
echo "Tunnel PID: $TUNNEL_PID"
trap "echo 'Stopping tunnel...'; kill $TUNNEL_PID 2>/dev/null; exit 0" INT TERM
wait $TUNNEL_PID
