#!/usr/bin/env bash
# Apply go2rtc-optimised stream settings to a single Hipcam camera.
# Usage: HIPCAM_PASSWORD=<pass> bash hipcam_setup_camera.sh <ip> [port]
# Default port: 80

set -euo pipefail

IP="${1:?Usage: HIPCAM_PASSWORD=<pass> bash hipcam_setup_camera.sh <ip> [port]}"
PORT="${2:-80}"
PASSWORD="${HIPCAM_PASSWORD:?Set HIPCAM_PASSWORD env var}"
BASE="http://${IP}:${PORT}/cgi-bin/hi3510/param.cgi"

echo "=== Hipcam stream setup: ${IP}:${PORT} ==="

# ── Connectivity check ─────────────────────────────────────────────────────
echo -n "Ping ${IP} ... "
if ! ping -c 2 -W 2 "${IP}" &>/dev/null; then
  echo "UNREACHABLE — camera offline or wrong IP"
  exit 1
fi
echo "OK"

# ── Helper ─────────────────────────────────────────────────────────────────
cgi() {
  curl -sf --max-time 8 \
    -u "admin:${PASSWORD}" \
    "${BASE}?${1}"
}

# ── Read current settings ──────────────────────────────────────────────────
echo ""
echo "--- Current stream 1 (main) settings ---"
cgi "cmd=getvencattr&-chn=1" || echo "(read failed)"
echo ""
echo "--- Current stream 2 (sub) settings ---"
cgi "cmd=getvencattr&-chn=2" || echo "(read failed)"
echo ""

# ── Apply main stream: 1920×1080, CBR 2048kbps, 15fps, GOP 30 ─────────────
echo "Applying main stream settings (chn=1) ..."
cgi "cmd=setvencattr&-chn=1&-bps=2048&-fps=15&-gop=30&-brmode=0&-imagegrade=4"
echo ""

# ── Apply sub stream: 640×480, CBR 512kbps, 10fps, GOP 20 ─────────────────
echo "Applying sub stream settings (chn=2) ..."
cgi "cmd=setvencattr&-chn=2&-bps=512&-fps=10&-gop=20&-brmode=0&-imagegrade=4"
echo ""

# ── Verify ────────────────────────────────────────────────────────────────
echo "--- Verified stream 1 (main) ---"
cgi "cmd=getvencattr&-chn=1" || echo "(read failed)"
echo ""
echo "--- Verified stream 2 (sub) ---"
cgi "cmd=getvencattr&-chn=2" || echo "(read failed)"
echo ""

echo "=== Done — restart camera RTSP feed in go2rtc if needed ==="
