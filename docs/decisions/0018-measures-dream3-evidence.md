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
