# Engine measurements

These scripts drive the real server, store, esbuild and canvas page. Chromium is headless with
`--disable-gpu` (CPU only). Every listener starts on port 0, except the restart tests, which
bring a server back on the port it had. No dependencies were added.

The harness (corpus, perf, soak) was first built by Codex against an older core; it was then
rebuilt here on the current canvas (shared React runtime, session tokens, hash revisions,
`src/chromium.js`).

```sh
node bench/corpus.js --size 40            # prints the temp folder it made; remove it when done
node bench/perf.js                        # PRF-01..08 and REL-05; one row: --id PRF-02
node --test test/engine/                  # REL-03 reconnect + shared-runtime tests (EVIDENCE=1 records the REL-03 text)
node bench/soak.js --duration 1800 --size 200 --interval 1000 --seed 1729   # REL-04
```

Each measured row writes `docs/evidence/<ID>.json` (raw samples, machine, method, SHA-256
of the measured sources) and `<ID>.txt` (result and the exact re-run command). A missed bar
exits nonzero after the measurements are written; `node bench/perf.js` runs every row even
when one misses. Generated TSX never goes into git. The branch-switch row stages and commits
only inside its generated temp repo.

Default `npm test` skips the expensive workloads. To run them as tests:

```sh
PERF=1 node --test test/engine/bench.test.js
SOAK=1 node --test test/engine/bench.test.js     # 60 s soak, writes REL-04-60s only
```

## Methods

- `PRF-01` starts the clock before the server spawns and stops it after all 40 sections are
  ready, every expected cell holds its component, there are zero build/render errors and two
  animation frames have run. Chromium launch is excluded; the OS file cache is not flushed.
- `PRF-02`, `PRF-03`, `PRF-08` use wall-clock times (`performance.timeOrigin + performance.now()`)
  so a separate MCP process and the page share a clock. "Painted" means: the new value is in
  every cell of the edited component, layout is forced, then two `requestAnimationFrame`
  callbacks have run (a conservative paint proxy, not a physical display). 40 trials, the first
  10 are warm-up and not counted, nearest-rank p95. The edited component is revealed at its own
  size first, with 200 components (1,131 cells) loaded; an edit to a component that is off-screen
  is deliberately not drawn until it scrolls into view.
  - `PRF-02` types a new default for a setting and presses Tab; timed from that key event.
  - `PRF-03` is an MCP `apply_edits` call from another process.
  - `PRF-08` types into the padding field with focus kept; timed from the `input` event to the
    selected node showing the new padding (the canvas previews while you type; the edit is written
    on commit).
- `PRF-04` first lays the 200 generated components out as a grid (about square; the stage packs the
  corpus into one tall column when it is packed zoomed out) and selects the component nearest the middle.
  It then sends real CDP wheel events for five seconds (one every 16 ms without waiting for each
  acknowledgement; about 300 land) while a Chromium trace (Tracing domain) records. Four runs:
  `pan` (30% zoom, scrolling about 370 px back and forth around the selection; it stays on screen),
  `pan+zoom` (the same with every twelfth event a Ctrl-wheel zoom step, 1.27x, in for a second, out for a
  second, anchored on the selection), `sweep+zoom` (30%, 25 px per event around a square of about 7,500 px,
  so components are un-culled and rasterised throughout; the selection leaves the screen) and `overview`
  (the same sweep from 10%). Reported per run: raw p95 frame time (presentation to presentation, from the
  compositor's PipelineReporter events), the same rounded to whole vsyncs, frames of at least 25 and 33 ms
  and the longest frame, dropped frames, main-thread long tasks (over 16.7 ms) with the longest, the
  components on screen and un-culled (geometry sampled every 100 ms, no layout) and the share of frames with
  the selection on screen. At 30% zoom the real components are tall: 3 to 10 are on screen (not 30), and 10%
  zoom shows up to 28.
  The same run measures two floors in Chromiums of their own: a page that only moves a translate3d every
  frame, and the same page driven by the same wheel events, with `loadavg` and the number of chromium
  processes. Pass, every run: raw p95 <= max(16.7, floor + 1) ms, at most 2% of frames >= 25 ms and at most
  2% dropped. The benchmark never injects a transform.
  Floor on this machine, five-second runs: raw p95 16.85 to 17.08 ms (0 frames >= 25 ms), with 51 to 66
  chromium processes alive and a load average of 1.7 to 2.8 (other agents' suites).
  State at the last commit (three consecutive runs, all FAIL): `pan` passes the frame bar in two of three
  runs (raw p95 17.3 to 18.5 against a bar of 17.9 to 18.1, 0 to 3 frames of 300 at 25 ms or more, 0 long
  tasks, longest main-thread task 13 to 15 ms); `pan+zoom` and `sweep+zoom` have raw p95 of about 21 ms and
  1.4 to 3% of frames at 25 ms or more, with one stall of 200 to 380 ms where the zoom turns round at about
  1 s (the main thread is not busy then: the compositor is waiting for tiles to rasterise, 100 ms of raster
  work on the thread pool, on CPU raster with the machine shared); `overview` (120 components drawn) has
  5 to 10% of frames at 25 ms or more, 30 dropped frames and 11 to 16 long tasks (longest 24 to 30 ms).
  Where the time went: see docs/engine.md.
  Tradeoffs the pan and zoom path accepts: during a gesture the `--nk-ls` scale of the in-frame chips and
  axis labels waits for the view to settle (160 ms idle), so they can be the wrong size while you keep
  moving; titles are kept readable by setting their scale on the few titles on screen; frames outside 0.12
  viewport are not drawn until they come inside it (and are invisible, not blank white, until then); a zoom
  gesture un-culls nothing until it settles; the dot grid is hidden while zooming and redrawn on settle; the
  settle itself is one 20 to 40 ms task (title and label restyle).
- `PRF-05`/`PRF-06` apply 2,000 real `store.apply` edits to a 200-component workspace and time
  the incremental esbuild rebuild and the whole apply-to-bundle path. Edit #1 and #2000 are kept.
- `PRF-07` samples the server's `VmRSS` and the page's live JS heap after an explicit GC.
- `REL-04`: two concurrent agents choose seeded random components and valid edits for the
  duration; every accepted revision (or a newer one) must reach the page; all files are parsed
  each minute and at the end; RSS growth is the largest sample against the post-warm-up baseline.
- `REL-05` runs an actual `git checkout` in a generated temp repo that changes all 40 files.
