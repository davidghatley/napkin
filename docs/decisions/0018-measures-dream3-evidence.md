# 0018: Measures — DREAM 3 evidence and corpus

Status: accepted for the measuring lane, 2026-11-12.

The seven benches exercise the public CLI, HTTP, MCP and Chromium. They never import
product internals except the existing Chromium process launcher. Missing endpoints,
missing evidence and unavailable external reviews fail. They cannot improve a score
by skipping a workload. D8 remains outside this lane.

The locked dream leaves several observable details unspecified. The bench README
records keyboard journeys, semantic viewer markers, a discovery convention for MCP
route mirrors, and the format for independent review evidence. These conventions
make failures reproducible; they do not change the locked dream. Builders may expose
normal accessible controls rather than special test hooks.

Corpus material is authored here and dedicated to CC0. Fonts contain original simple
geometric outlines, not extracted system glyphs. Media is synthesized with CPU ffmpeg.
No runtime dependencies are added. To rebuild the small binary corpus, optional,
pinned generator tools are installed outside the project: apache-arrow 21.1.0
(Apache-2.0), parquetjs-lite 0.8.7 (MIT), opentype.js 1.3.4 (MIT). These write real
standards-based files and are never imported by the product. Large parquet generation
uses a small in-lane writer so ordinary bench execution needs no npm install.

Human judgments and real agent/GPU runs cannot be inferred from HTTP success. They
remain failing gates without independently supplied evidence. The machine rule for
this lane forbids GPU work, so this builder will not perform the real generation smoke.

The large video repeats encoded H.264 keyframes with real timestamps. Its payload is
over 2 GB, not a sparse file or a small clip with a large padding atom. The parquet
has five million rows spread over bounded, independently readable row groups. The
memory gate samples the owned server process tree from spawn, compares it with an
empty-folder process, and also samples the page's heap and backing storage. Each
increase must stay below 60% of input bytes. This is an explicit operational bound
for “without loading whole,” not a claim that RSS reveals every allocator or OS cache.

## Round 2 (critic verdict 3/10): semantic checks and lead-attested gates

The first harness could be passed by cheap fakes: an invented SVG viewer, a board that never
rearranged, a focus check that accepted zero changed pixels, a timing check fed by an
unrelated animation, and self-written evidence files for every qualitative gate. Decisions:

- Every value a viewer or instrument must show is chosen at bench time (colours, durations,
  amplitude ramps, zip entries, binary bytes, chart data, names), and oracles read the
  screen and the files, not tags. Timing uses a causal random walk of key presses.
- Qualitative gates (blind rubrics, studios, real Codex and opencode runs, the real GPU smoke,
  the slop audit) are lead-attested: an HMAC-signed document kept outside the repository, tied
  to the product source hash. A file in the repo cannot satisfy them; absent input is "not met".
  The earlier `--reviews` file with a self-declared reviewer name is removed.
- D8 is part of the scoreboard (`bench/craft.js`) and so are the three legacy benches and the
  full test suite; skipped or unexecuted parts block acceptance.
- The mock ComfyUI follows the real server's SaveVideo shape (VIDEO output, nested dynamic
  codec choice, optional codec), validates nested dynamic inputs and link-typed inputs, and
  emits a random-length progress stream so a client cannot invent stage events. Real
  /object_info was compared with GET requests only.
- The frame-interval budget is 17.2 ms for the "p95 frame < 16.7 ms" marks: rAF timestamps are
  vsync-quantised, a perfect 60 Hz page measures up to about 16.9 ms and a page that misses
  a vsync at least 33 ms.
