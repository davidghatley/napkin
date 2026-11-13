# 0019 · Dials: every control gets a studio instrument by construction

Status: accepted · 2026-11-12 · DIALS lane, round 6

## Context

Round 5 had six hand-built studios (colour, type, motion, image, data, sampler) and a general fallback that split a section's other controls into columns of rows. A critic found tabs that opened to a half-empty pane: any control outside the six labs, and any type the library had not seen, got a small row and white space. Patching studio by studio could not keep up with new types.

## Decision

A studio tab is one control. The six labs keep the controls they own. Every other control opens one frame, `instruments.js`, with fixed parts: a stage you drag, a strip of minis across the range, the full readout, fields, the value against its default, how it was declared, and this session's history. Only the stage differs. It is picked from the control's type, then its `figure`, then the shape of its value (options, number, boolean, string, pair, number list, object). An object with no known type gets one lane per key and a tolerant source box. `registerInstrument(type, make)` lets a host replace a stage.

Because the frame owns layout, a new type cannot produce an empty pane. The worst case is the record instrument, which still draws every key. The test suite opens every tab of every sample and of a schema the library was not written for (`lampRig`), and checks that each one has a drawn stage and no clipped text.

## Consequences

- The old general and per-type studios in `studios.js` were deleted, along with about 600 lines of CSS that only they used.
- Long values are designed for, not clipped: readouts wrap, and row values are growing text areas.
- A domain studio still beats the frame for rich types. The frame is the floor, not the ceiling.
- No new dependencies.
