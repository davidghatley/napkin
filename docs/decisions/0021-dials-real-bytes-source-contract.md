# 0021 · Dials: pictures come from the host or say they are missing

Status: accepted · 2026-11-12 · DIALS lane, round 8

## Context

The round 7 critic found figures that drew content the panel did not have: a still life standing in for an asset under its real file name, seed tiles painted from the seed number, scatter points when a section had no data. A reader could not tell a real preview from an invented one. The library has no way to read files itself; only the host knows where an asset's bytes live.

## Decision

Every figure that shows a picture asks for real bytes through one module, `public/dials/sources.js`, in this order:

1. a file the person chose in the studio, held for the value it was chosen as;
2. the host's `source(control, value)` option (a URL, Blob, File, ImageBitmap, canvas or `<img>`, a promise of one, or `null`);
3. the control's own `source` in the schema (a URL or `{ url, name, type }`), which for an `asset` or `file` stops applying when the value names a different file.

When none of these gives bytes, the figure shows an unavailable state in words ("No pixels for photo.jpg: the host has not supplied its bytes"), and a failed load names its error. Charts, marks and measures read the section's own `data` and sibling controls; without them they draw an empty frame with a note. A seed is drawn as its own 32 bits, not as an invented picture.

## Consequences

- Hosts that want previews must supply bytes. The demo page is a host: it draws its own `still-life.png` and hands it over as the schema `source` of the asset controls that name that file.
- The still-life stand-in was removed from `kit.js`; `sectionPoints` returns an empty list without data.
- Results are cached per panel, control and value, so swapping a panel does not refetch while a value is unchanged.
- No new dependencies.
