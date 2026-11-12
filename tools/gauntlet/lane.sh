#!/usr/bin/env bash
# Dream-gauntlet lane driver: builder (Codex) -> tests -> fresh critic (Codex) -> repeat.
# usage: tools/gauntlet/lane.sh <lane> [max_rounds]
# Lane files live in .dream-gauntlet/d3/lanes/<lane>/{brief.md,critic.md,test.cmd}; the worktree is ../napkin-d3-<lane>.
set -u
LANE=$1; MAX=${2:-3}
CORE=$(cd "$(dirname "$0")/../.." && pwd)
GD=$CORE/.dream-gauntlet/d3; L=$GD/lanes/$LANE; R=$GD/rounds/$LANE
WT=$(dirname "$CORE")/napkin-d3-$LANE
GITDIR=$(cd "$WT" && cd "$(git rev-parse --git-common-dir)" && pwd)
mkdir -p "$R"
cx() { # cx <minutes> <outfile> <logfile> <promptfile>; waits out Codex usage limits and retries
  local try
  for try in 1 2 3 4 5 6; do
    timeout "${1}m" codex exec -C "$WT" -s workspace-write -c model_reasoning_effort="${EFFORT:-high}" \
      -c sandbox_workspace_write.network_access=true --add-dir "$GITDIR" --add-dir "$GD" -o "$2" - < "$4" > "$3" 2>&1
    local rc=$?
    grep -q "hit your usage limit" "$3" || return $rc
    local at; at=$(grep -o "try again at [0-9:]* [AP]M" "$3" | tail -1 | sed 's/try again at //')
    local wait=1800; [ -n "$at" ] && wait=$(( $(date -d "$at" +%s) - $(date +%s) + 180 )); [ "$wait" -lt 0 ] && wait=$((wait+86400)); [ "$wait" -gt 43200 ] && wait=1800
    echo "$LANE: Codex usage limit, waiting ${wait}s (try $try)" >> "$GD/progress.log"; cp "$3" "$3.limit$try"; sleep "$wait"
  done; return 1
}
score() { node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(Number(j.score)||0)}catch{console.log(0)}' "$1"; }
n=$(find "$R" -mindepth 1 -maxdepth 1 -type d | wc -l); best=0; flat=0; stalled=0
[ "$n" -gt 0 ] && for d in "$R"/*/; do s=$(score "$d/score.json"); best=$(node -e "console.log(Math.max($best,$s))"); done
for _ in $(seq 1 "$MAX"); do
  n=$((n+1)); D=$R/$n; P=$R/$((n-1)); mkdir -p "$D/evidence"
  { cat "$GD/builder-head.md" "$L/brief.md"
    echo; echo "ROUND: $n. Write your report to $D/builder.md is done for you; just end with the report."
    if [ -f "$P/verdict.md" ]; then echo "LATEST CRITIC VERDICT: read $P/verdict.md first and close its gaps in rank order."; [ -f "$P/tests.log" ] && echo "LAST TEST RUN: exit $(cat "$P/tests.exit" 2>/dev/null); log $P/tests.log";
    else echo "This is the first round: there is no verdict yet."; fi
    [ -n "$(cd "$WT" && git status --porcelain)" ] && echo "NOTE: an earlier builder session was cut off mid-work, so there are uncommitted changes in the tree. Review them first (git status, git diff), keep what is good, finish the job and commit."
    [ "$stalled" = 1 ] && echo "STALL: the score has not moved in two rounds. Stop tweaking. Find the structural cause and make one deliberate big change, even if it means throwing code away."
  } > "$D/builder-prompt.txt"
  cx 120 "$D/builder.md" "$D/builder.log" "$D/builder-prompt.txt"; echo "builder exit $?" > "$D/status"
  if [ -s "$L/test.cmd" ]; then ( flock 9; cd "$WT" && timeout 45m bash "$L/test.cmd" > "$D/tests.log" 2>&1; echo $? > "$D/tests.exit" ) 9>"$GD/suite.lock"; fi
  ( cd "$WT" && git status --porcelain > "$D/dirty-before-critic.txt"; git log --oneline -15 > "$D/commits.txt"; git diff --stat feat/core -- docs/DREAM3.md > "$D/dream-touched.txt" )
  { cat "$GD/critic-head.md" "$L/critic.md"
    echo; echo "ROUND: $n. Put screenshots and raw output in $D/evidence/. Write nothing else anywhere except scratch files under $D/."
    [ -f "$D/tests.log" ] && echo "TEST RUN by the orchestrator: exit $(cat "$D/tests.exit"); log $D/tests.log"
    [ -f "$P/verdict.md" ] && echo "PREVIOUS ROUND: verdict $P/verdict.md, evidence $P/evidence/. Do not read any builder.md or builder.log file."
    echo "Finish by writing $D/score.json as {\"score\": <0-10 number>, \"measures_met\": <bool>, \"top_gap\": \"<one line>\"} and end your reply with the full verdict (it is saved as $D/verdict.md)."
  } > "$D/critic-prompt.txt"
  EFFORT=${CRITIC_EFFORT:-medium} cx 60 "$D/verdict.md" "$D/critic.log" "$D/critic-prompt.txt"; echo "critic exit $?" >> "$D/status"
  s=$(score "$D/score.json"); echo "$LANE round $n score $s (best before $best)" | tee -a "$GD/progress.log"
  if node -e "process.exit($s>=8?0:1)"; then echo "$LANE PASSED at round $n" | tee -a "$GD/progress.log"; break; fi
  if node -e "process.exit($s>=$best+0.5?0:1)"; then flat=0; stalled=0; else flat=$((flat+1)); fi
  best=$(node -e "console.log(Math.max($best,$s))")
  if [ "$flat" -ge 2 ]; then if [ "$stalled" = 1 ]; then echo "$LANE STALLED at round $n" | tee -a "$GD/progress.log"; break; fi; stalled=1; flat=1; fi
done
echo "$LANE driver done: rounds=$n best=$best last=$(cat "$R/$n/score.json" 2>/dev/null | tr -d '\n' | cut -c1-300)"
