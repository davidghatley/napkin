#!/usr/bin/env bash
# One fresh Codex critic for a round. usage: tools/gauntlet/critic.sh <lane> <round>
# Exit 0 = verdict.md and score.json written; exit 75 = Codex usage limit (use another critic); other = failed.
set -u
LANE=$1; N=$2
CORE=$(cd "$(dirname "$0")/../.." && pwd); GD=$CORE/.dream-gauntlet/d3; D=$GD/rounds/$LANE/$N; P=$GD/rounds/$LANE/$((N-1))
WT=$(dirname "$CORE")/napkin-d3-$LANE; GITDIR=$(cd "$WT" && cd "$(git rev-parse --git-common-dir)" && pwd)
mkdir -p "$D/evidence"
{ cat "$GD/critic-head.md" "$GD/lanes/$LANE/critic.md"
  echo; echo "ROUND: $N. Put screenshots and raw output in $D/evidence/. Write nothing else anywhere except scratch files under $D/."
  [ -f "$D/tests.log" ] && echo "TEST RUN by the orchestrator: log $D/tests.log"
  [ -f "$P/verdict.md" ] && echo "PREVIOUS ROUND: verdict $P/verdict.md, evidence $P/evidence/."
  echo "Do not read any builder.md or builder.log file."
  echo "Finish by writing $D/score.json as {\"score\": <0-10 number>, \"measures_met\": <bool>, \"top_gap\": \"<one line>\"} and end your reply with the full verdict."
} > "$D/critic-prompt.txt"
timeout 60m codex exec -C "$WT" -s workspace-write -c model_reasoning_effort="${CRITIC_EFFORT:-medium}" -c sandbox_workspace_write.network_access=true \
  --add-dir "$GITDIR" --add-dir "$GD" -o "$D/verdict.md" - < "$D/critic-prompt.txt" > "$D/critic.log" 2>&1
grep -q "hit your usage limit" "$D/critic.log" && { rm -f "$D/verdict.md"; exit 75; }
[ -s "$D/score.json" ] && [ -s "$D/verdict.md" ]
