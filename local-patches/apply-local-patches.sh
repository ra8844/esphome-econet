#!/usr/bin/env bash
# apply-local-patches.sh — re-apply this deployment's LOCAL changes to upstream-owned files
# after update-from-upstream.sh has copied an upstream release over them.
#
# Why: update-from-upstream.sh overwrites econet_base.yaml wholesale. The HAOS copy of
# econet_base.yaml carries three lines that upstream does not have (API encryption key and
# OTA password, both as !secret references). Without them the deployed device would lose API
# encryption and its OTA password. Context-diff patches break when upstream rewrites nearby
# code (v3.8.3 rewrote the neighbouring lambda), so this inserts by anchor instead.
#
# Usage:  local-patches/apply-local-patches.sh [path/to/econet_base.yaml]   (default: ./econet_base.yaml)
# Idempotent: does nothing if the lines are already present. Exits non-zero, changing
# nothing, if an anchor is missing or ambiguous (read the upstream change, then adjust).
#
# The values live in HAOS /config/esphome/secrets.yaml as econet__encryption_key and
# econet__ota_password. Only the !secret references are kept here, never the values.
set -euo pipefail

F="${1:-econet_base.yaml}"
[ -f "$F" ] || { echo "no such file: $F" >&2; exit 2; }

if grep -q 'econet__encryption_key' "$F" && grep -q 'econet__ota_password' "$F"; then
  echo "already applied: $F"
  exit 0
fi

# Anchors must each occur exactly once.
[ "$(grep -c '^ota:$' "$F")" = 1 ] || { echo "anchor '^ota:\$' not found exactly once in $F" >&2; exit 1; }
[ "$(grep -c '^  platform: esphome$' "$F")" = 1 ] || { echo "anchor '  platform: esphome' not found exactly once in $F" >&2; exit 1; }

TMP="$(mktemp)"
awk '
  /^ota:$/            { print "  encryption:"; print "    key: !secret econet__encryption_key"; inota=1 }
  { print }
  inota && /^  platform: esphome$/ { print "  password: !secret econet__ota_password"; inota=0 }
' "$F" > "$TMP"

added=$(diff "$F" "$TMP" | grep -c '^>' || true)
[ "$added" = 3 ] || { echo "expected 3 added lines, got $added; leaving $F unchanged" >&2; rm -f "$TMP"; exit 1; }
cat "$TMP" > "$F"; rm -f "$TMP"
echo "applied 3 local lines to $F"
