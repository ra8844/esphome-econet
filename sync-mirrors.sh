#!/usr/bin/env bash
# Push this repo to GitHub AND all configured mirror machines in one shot.
# Mirrors are pushed DIRECTLY over SSH.
#
# Currently configured mirror remotes:
#   m4   -> SN-MacMini2 (macOS, 192.168.1.50)   URL: m4:Repositories/esphome-econet
#   cams -> 3923-cams   (Linux, 192.168.1.85)   URL: 192.168.1.85:Repositories/esphome-econet
#
# NOTE: `upstream` (esphome-econet/esphome-econet) is a FETCH-ONLY source of community
# releases and is deliberately skipped here — see update-from-upstream.sh.
#
# To add another mirror:
#   1) ensure SSH key access from this machine to it
#   2) on that machine, once:
#        git clone git@github.com:ra8844/esphome-econet.git ~/Repositories/esphome-econet
#        git -C ~/Repositories/esphome-econet config receive.denyCurrentBranch updateInstead
#   3) here, once, with a HOME-RELATIVE path (works on macOS /Users and Linux /home):
#        git remote add <name> <user>@<ip>:Repositories/esphome-econet
set -uo pipefail
cd "$(dirname "$0")" || exit 1
BRANCH="${1:-main}"

echo "== origin (GitHub) =="; git push origin "$BRANCH" 2>&1 | tail -2

for m in $(git remote | grep -vxE 'origin|upstream'); do
  echo "== mirror: $m =="; git push "$m" "$BRANCH" 2>&1 | tail -2
done

echo "== verify mirror HEADs =="
echo "  local:  $(git rev-parse --short HEAD)"
for m in $(git remote | grep -vxE 'origin|upstream'); do
  host="$(git remote get-url "$m" | cut -d: -f1)"
  printf "  %-6s %s\n" "$m:" "$(ssh -o BatchMode=yes -o ConnectTimeout=6 "$host" 'git -C ~/Repositories/esphome-econet rev-parse --short HEAD' 2>&1)"
done
echo "(upstream is fetch-only and intentionally not pushed to.)"
