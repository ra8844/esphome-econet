#!/bin/bash
set -u

GO2RTC_API="http://127.0.0.1:1984/api"
RTSP_BASE="rtsp://127.0.0.1:8554"
LOG_FILE="/Users/sn/go2rtc-keepalive.log"
LEGACY_LOCK_FILE="/tmp/go2rtc-keepalive.lock"
LOCK_DIR="/tmp/go2rtc-keepalive.lock.d"
FFMPEG_BIN="/opt/homebrew/bin/ffmpeg"

STREAMS=(
  # Wyze P2P
  front_door_camera_main
  front_door_camera_sub
  living_room_camera_main
  living_room_camera_sub

  # Hipcam — master bathroom
  master_bathroom_camera_1_main
  master_bathroom_camera_1_sub
  master_bathroom_camera_2_main
  master_bathroom_camera_2_sub

  # Hipcam — office
  office_camera_main
  office_camera_sub

  # Hipcam — master bedroom
  master_bedroom_camera_1_main
  master_bedroom_camera_1_sub

  # Hipcam — hallway
  hallway_camera_1_main
  hallway_camera_1_sub
  hallway_camera_2_main
  hallway_camera_2_sub

  # Hipcam — kitchen
  kitchen_camera_1_main
  kitchen_camera_1_sub
  kitchen_camera_2_main
  kitchen_camera_2_sub

  # Eufy garage
  eufy_garage_camera_1_main

  # Reolink
  garage_outside_doorbell_main
  garage_outside_doorbell_sub
  garage_outside_camera_main
  garage_outside_camera_sub
  courtyard_doorbell_main
  courtyard_doorbell_sub
  backyard_doorbell_main
  backyard_doorbell_sub
)

log() {
  printf "%s %s\n" "$(date "+%Y-%m-%d %H:%M:%S")" "$*" >> "$LOG_FILE"
}

cleanup() {
  local pids
  pids="$(jobs -p)"
  if [[ -n "$pids" ]]; then
    kill $pids 2>/dev/null || true
  fi
  rmdir "$LOCK_DIR" 2>/dev/null || true
}

rm -f "$LEGACY_LOCK_FILE"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  log "another keepalive instance is already running"
  exit 0
fi

trap cleanup EXIT INT TERM

if [[ ! -x "$FFMPEG_BIN" ]]; then
  log "ffmpeg not found at $FFMPEG_BIN"
  exit 1
fi

wait_for_go2rtc() {
  until curl -fsS "$GO2RTC_API" >/dev/null 2>&1; do
    log "waiting for go2rtc API"
    sleep 5
  done
}

keepalive_stream() {
  local stream="$1"
  while true; do
    wait_for_go2rtc
    log "starting keepalive for ${stream}"
    "$FFMPEG_BIN" -hide_banner -loglevel warning -rtsp_transport tcp -i "${RTSP_BASE}/${stream}" -c copy -f null - >> "$LOG_FILE" 2>&1
    log "keepalive ended for ${stream}; retrying in 5s"
    sleep 5
  done
}

log "keepalive supervisor starting"
for stream in "${STREAMS[@]}"; do
  keepalive_stream "$stream" &
done
wait
