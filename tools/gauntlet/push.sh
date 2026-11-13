#!/usr/bin/env bash
# Push the integration branch and every lane branch to origin, after a check for private details.
# usage: tools/gauntlet/push.sh            (once)      tools/gauntlet/push.sh --every 1200   (loop, seconds)
set -u
cd "$(dirname "$0")/../.."
# Patterns that must never be pushed live in an untracked file, one extended regex on the first line.
PRIVATE=$(head -1 .dream-gauntlet/private-patterns 2>/dev/null); [ -n "$PRIVATE" ] || { echo "no .dream-gauntlet/private-patterns file: refusing to push"; exit 1; }
once() {
  for b in feat/core $(git for-each-ref --format='%(refname:short)' 'refs/heads/d3/*'); do
    if git grep -I -l -E "$PRIVATE" "$b" -- . >/dev/null 2>&1; then echo "$(date +%H:%M) SKIP $b: private detail found"; continue; fi
    git push -q origin "$b" 2>&1 | tail -1; echo "$(date +%H:%M) pushed $b $(git rev-parse --short "$b")"
  done
}
if [ "${1:-}" = "--every" ]; then while true; do once; sleep "${2:-1200}"; done; else once; fi
