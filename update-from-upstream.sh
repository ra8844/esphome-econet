#!/usr/bin/env bash
# update-from-upstream.sh — pull community (upstream) changes into this fork.
#
# WHY A SCRIPT: this repo shares NO git history with upstream
# (`git merge-base HEAD upstream/main` exits 1 — same first-commit messages,
# different SHAs). So `git merge` / "Sync fork" do not work. Updates are done by
# copying CONTENT from an upstream tag: `git checkout <tag> -- <paths>`.
#
# USAGE
#   ./update-from-upstream.sh                # show what's available + what differs
#   ./update-from-upstream.sh upstream-v3.8.0   # apply that tag's content (no commit)
#
set -uo pipefail
cd "$(dirname "$0")"

# Files this deployment actually uses. tlwh-rtgh-sn.yaml is OURS — never overwrite it.
PATHS=(
  components/econet
  econet_tankless_water_heater.yaml
  econet_base.yaml
  econet_water_heater_base.yaml
)

if ! git remote get-url upstream >/dev/null 2>&1; then
  echo "adding upstream remote…"
  git remote add upstream https://github.com/esphome-econet/esphome-econet.git
fi

# NOTE: this fork carries its OWN tags with the same names as upstream's
# (v3.0.2, v3.1.0, v3.2.0 …) pointing at different commits, because the histories
# are unrelated. A bare `git tag -l` is therefore a MIXED namespace and
# `git checkout v3.8.0` could resolve to the wrong one. Upstream tags are fetched
# into a separate `upstream-*` namespace so they can never collide.
echo "== fetching upstream (tags namespaced as upstream-*) =="
git fetch upstream '+refs/heads/*:refs/remotes/upstream/*' 2>&1 | tail -2
git fetch upstream '+refs/tags/*:refs/tags/upstream-*' 2>&1 | tail -2

LATEST=$(git tag -l 'upstream-v*' | sed 's/^upstream-//' | sort -V | tail -1)
LATEST="upstream-$LATEST"
TARGET="${1:-}"

echo
echo "== upstream releases =="
git tag -l 'upstream-v*' | sed 's/^upstream-//' | sort -V | tail -6 | sed 's/^/  /'
echo "  latest: ${LATEST#upstream-}"

echo
echo "== what differs between HEAD and $LATEST (deployment-relevant paths only) =="
if git diff --quiet HEAD "$LATEST" -- "${PATHS[@]}" 2>/dev/null; then
  echo "  nothing — already current with $LATEST"
else
  git diff --stat HEAD "$LATEST" -- "${PATHS[@]}" | sed 's/^/  /'
  echo
  echo "  >> REVIEW FOR BREAKING CHANGES before applying. Known example: v3.7.0 moved"
  echo "     'api: services:' to 'api: actions:' (mutually exclusive), which required"
  echo "     deleting the services block from tlwh-rtgh-sn.yaml."
  git log --oneline "$LATEST" -15 2>/dev/null | sed 's/^/     /'
fi

if [ -z "$TARGET" ]; then
  echo
  echo "== dry run only. To apply:  $0 $LATEST =="
  exit 0
fi

echo
echo "== applying $TARGET (content copy, no history merge) =="
git checkout "$TARGET" -- "${PATHS[@]}" || { echo "FAILED"; exit 1; }
git status --porcelain -- "${PATHS[@]}" | sed 's/^/  /'

cat <<'NEXT'

== NEXT STEPS (nothing has been deployed or committed) ==
  1. Review:      git diff --cached --stat
  2. Deploy to HAOS:
       for f in econet_tankless_water_heater.yaml econet_base.yaml econet_water_heater_base.yaml; do
         cat "$f" | ssh haos "sudo -n tee /config/esphome/$f >/dev/null"
       done
       tar -cf - components | ssh haos 'sudo -n tar -x -C /config/esphome/external_components/esphome-econet'
  3. ESPHome dashboard -> Validate on econet-tlwh-atomic-s3   (catches schema breaks)
  4. Install -> Manual download                                (compiles, does NOT flash)
  5. Only then: Install -> Wirelessly
  6. Watch logs: temps sane, no repeating UNSUPPORTED/parse warnings, MCU connected
  7. Commit here once verified.

  Rollback: /config/esphome/ROLLBACK-upstream.sh (restores the last pre-upgrade backup)
NEXT
