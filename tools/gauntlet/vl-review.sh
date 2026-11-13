#!/usr/bin/env bash
# Cheap third-family visual second opinion on screenshots, via a free OpenRouter vision model in opencode.
# usage: tools/gauntlet/vl-review.sh <out.md> "<what the screen is>" <image>...   (max 6 images; runs one at a time)
# Notes are unverified opinions for the next builder, never a score. Free tier: about 50 requests a day in total.
set -u
OUT=$1; WHAT=$2; shift 2
MODEL=${VL_MODEL:-openrouter/nvidia/nemotron-3.5-super-vl:free}
: > "$OUT"; n=0
for IMG in "$@"; do
  n=$((n+1)); [ "$n" -gt 6 ] && break
  P="You are a picky senior product designer. The attached screenshot is: $WHAT. List the 8 most damaging visual or usability flaws you can actually see, most important first, each with the exact location and a concrete fix. Only report what is visible; if unsure, say so. No praise. Do not use tools. At most 200 words."
  { echo "## $(basename "$IMG")"; ( flock 9; timeout 180 opencode run -m "$MODEL" "$P" -f "$IMG" 2>&1 ) 9>/tmp/claude-1000/opencode.lock | sed 's/\x1b\[[0-9;]*m//g' | grep -v '^> build' ; echo; } >> "$OUT"
done
echo "wrote $OUT ($n images)"
