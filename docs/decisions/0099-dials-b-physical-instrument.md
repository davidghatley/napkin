# 0099 dials-b: physical instrument look (design-off entry b)

Status: proposed

Direction: the dials panel reads as a hardware instrument. Raised caps (fader, knob, puck, lever) mark what can be grabbed; grooves and dark displays are recessed; everything else is flat. One signal orange on bone-grey (light) or graphite (dark). Inter throughout with tabular figures; mono only for code.

Choices
- Figures are the grab surface: faders map the pointer to the value with a detent at the default, knobs follow the turn, the origin pad is two-axis, switches toggle on click. Shift is fine. Typed entry and keys are unchanged.
- Bench shows rows only (8 controls in about 380 px); the lab appears at Studio. Studio rail keeps the same rows, so dial, bench and studio read as one object growing.
- Studio sliders are the same faders (styled range inputs); color faders are painted with the range they travel.
- Figure updates morph in place so caps travel with a short spring (170 ms, interruptible via registered custom properties).
- No new dependencies.

Tests changed (look only): collapsed section height 32 -> 44; compound-studio test opens the studio before typing because the bench no longer holds the lab.
