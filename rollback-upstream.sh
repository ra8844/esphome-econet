#!/usr/bin/env bash
# rollback-upstream.sh — restore the ESPHome econet deployment from the most
# recent pre-upgrade backup taken on the HAOS box.
#
# Run this ON the HAOS host (via `ssh haos`), not on a dev machine.
# The canonical copy lives in this repo; deploy it with:
#   cat rollback-upstream.sh | ssh haos 'sudo -n tee /config/esphome/rollback-upstream.sh >/dev/null && sudo -n chmod 755 /config/esphome/rollback-upstream.sh'
#
# Backups are created by the upgrade procedure as
#   /config/esphome/.pre-upstream-<timestamp>/
# and the newest path is recorded in
#   /config/esphome/.last-upstream-backup
#
set -euo pipefail

MARKER=/config/esphome/.last-upstream-backup

if [ -n "${1:-}" ]; then
  B="$1"
elif [ -f "$MARKER" ]; then
  B="$(cat "$MARKER")"
else
  echo "No backup marker at $MARKER and no path given."
  echo "Available backups:"
  ls -1d /config/esphome/.pre-upstream-* 2>/dev/null | sed 's/^/  /' || echo "  (none)"
  exit 1
fi

[ -d "$B" ] || { echo "Backup dir not found: $B"; exit 1; }

echo "Restoring from: $B"
ls -la "$B" | sed 's/^/  /'
echo

for f in econet_tankless_water_heater.yaml econet_base.yaml tlwh-rtgh-sn.yaml; do
  if [ -f "$B/$f" ]; then
    sudo -n cp -p "$B/$f" "/config/esphome/$f"
    echo "  restored $f"
  else
    echo "  SKIP $f (not in backup)"
  fi
done

if [ -d "$B/components-checkout" ]; then
  sudo -n rm -rf /config/esphome/external_components/esphome-econet
  sudo -n cp -a "$B/components-checkout" /config/esphome/external_components/esphome-econet
  echo "  restored components/econet checkout"
fi

# Files added by the upgrade that the backup predates - remove so the old
# package yamls do not sit alongside newer dependencies.
for f in econet_water_heater_base.yaml econet_time.yaml; do
  if [ -f "/config/esphome/$f" ] && [ ! -f "$B/$f" ]; then
    sudo -n rm -f "/config/esphome/$f"
    echo "  removed $f (added by the upgrade, absent from backup)"
  fi
done

cat <<'NEXT'

Files restored. NOTHING has been flashed.
  1. ESPHome dashboard -> Validate on econet-tlwh-atomic-s3
  2. Install -> Wirelessly   (restores the previous firmware)
  3. Confirm in logs: temps sane, MCU connected, climate tracking
NEXT
