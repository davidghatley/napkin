// Schemas the library did not write: every documented type with every documented value shape,
// plus the shapes agents and plugins actually send (null, huge numbers, long labels, nested
// arrays, colour lists, matrices, a 200-option enum, dates, URLs, tag lists, flag records).
// Used by fuzz.test.js and by shots-hostile.mjs. Plain data; no library imports.
const long = "Operator confidence rating for this particular shot, measured on set by the second assistant";
const many = Array.from({ length: 200 }, (_, i) => ({ label: `Preset ${String(i + 1).padStart(3, "0")} ${["warm", "cool", "flat", "punchy"][i % 4]}`, value: `p${i}` }));
const documented = [
  ["number", 12, { min: 0, max: 100, unit: "px" }],
  ["number", 0.5, {}],
  ["range", 1, { min: 0, max: 1, step: 0.01, figure: "opacity" }],
  ["number", 12, { min: 0, max: 64, figure: "radius", unit: "px" }],
  ["number", 4, { min: 1, max: 16, step: 1, figure: "count" }],
  ["number", 240, { min: 0, max: 2000, unit: "ms" }],
  ["number", 4500, { min: 1000, max: 12000, unit: "K" }],
  ["number", 40, { min: 0, max: 100, unit: "%" }],
  ["angle", 30, { min: -180, max: 180, unit: "deg" }],
  ["vector", [0.2, -0.4], { min: -1, max: 1 }],
  ["boolean", true, {}],
  ["boolean", false, { figure: "loop" }],
  ["select", "b", { options: ["a", "b", "c"] }],
  ["segmented", "center", { options: ["left", "center", "right"], figure: "align" }],
  ["select", "point", { options: [{ label: "Points", value: "point" }, { label: "Bars", value: "bar" }, { label: "Line", value: "line" }], figure: "mark" }],
  ["text", "A field guide to forms.", {}],
  ["text", "a (cobalt:1.3) lighthouse at dusk, paper texture", { figure: "prompt" }],
  ["color", "oklch(58% .21 265)", {}],
  ["color", "#3459e2", {}],
  ["gradient", "linear-gradient(120deg, #3459e2, #b8d7f5)", {}],
  ["shadow", { x: 0, y: 8, blur: 24, spread: 0, color: "#0004" }, {}],
  ["spacing", [16, 24, 16, 24], {}],
  ["typography", { text: "Ag", family: "system-ui", size: 32, weight: 500, tracking: 0, lineHeight: 1.2, axes: { wght: 500 } }, { axes: [{ tag: "wght", label: "Weight", min: 100, max: 900, default: 500 }] }],
  ["motion", { mode: "spring", bezier: [0.22, 0.8, 0.22, 1], duration: 1200, delay: 0, stiffness: 170, damping: 14, mass: 1, velocity: 0, loopRange: [0.2, 0.6] }, {}],
  ["motion", { mode: "bezier", bezier: [0.2, 0.8, 0.2, 1], duration: 400 }, {}],
  ["spring", { mode: "spring", stiffness: 300, damping: 20, mass: 1, duration: 800 }, {}],
  ["bezier", { mode: "bezier", bezier: [0.4, 0, 0.2, 1], duration: 300 }, {}],
  ["bezier", { duration: 300 }, {}],
  ["keyframes", [{ offset: 0, transform: "translateX(0px)", opacity: 0 }, { offset: 0.55, transform: "translateX(132px)", opacity: 1 }, { offset: 1, transform: "translateX(160px)", opacity: 1 }], { min: 0, max: 240 }],
  ["image", { black: 0, white: 1, gamma: 1, exposure: 0, saturation: 1, curve: [0, 0.25, 0.5, 0.75, 1], cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0, mask: 0 }, {}],
  ["encoding", { x: "distance", y: "energy", color: "group", size: "mass", mark: "point" }, { fields: ["distance", "energy", "group", "mass"], data: [{ distance: 1, energy: 2, group: "a", mass: 3 }, { distance: 2, energy: 3, group: "b", mass: 1 }] }],
  ["sampler", { steps: 28, cfg: 7, scheduler: "karras", shift: 1, seed: 42, locked: true, denoise: 1 }, {}],
  ["seed", 51654, { min: 0, max: 4294967295, step: 1 }],
  ["asset", "still-life.png", {}],
  ["file", "notes.pdf", {}],
];
// Shapes nobody documented, and values that are wrong.
const hostile = [
  ["number", null, { label: "Null number" }],
  ["number", 1.5e12, { label: "Budget", unit: "$" }],
  ["number", -3.2e9, { label: "Debt", unit: "$" }],
  ["number", 7, { label: long }],
  ["number", "42", { label: "Number as text", min: 0, max: 100 }],
  ["number", 900, { label: "Out of range", min: 0, max: 100 }],
  ["number", 1e-7, { label: "Tiny" }],
  ["select", "p17", { label: "Two hundred presets", options: many }],
  ["select", "nope", { label: "Unknown option", options: ["a", "b"] }],
  ["matrix", [[1, 0, 0], [0, 1, 0], [0, 0, 1]], { label: "Lens matrix" }],
  ["matrix", [[0.2, 0.8, 0.1, 0.4], [0.5, 0.3, 0.9, 0.6]], { label: "Wide matrix" }],
  ["palette", ["#3459e2", "#e2a134", "oklch(70% .15 150)", "rgb(200 40 80)", "#111"], { label: "Gel set" }],
  ["list", [0.1, 0.4, 0.9, 0.6, 0.3, 0.2, 0.5, 0.8], { label: "Profile" }],
  ["tags", ["warm", "handheld", "night", "rain"], { label: "Tags" }],
  ["date", "2026-11-12", { label: "Shoot date" }],
  ["datetime", "2026-11-12T18:30:00Z", { label: "Call time" }],
  ["url", "https://example.com/reference/board-12?take=3", { label: "Reference" }],
  ["flags", { stabilise: true, raw: false, proxy: true }, { label: "Flags" }],
  ["timecode", "01:02:03:04", { label: "Cut" }],
  ["vector", [1, 2, 3], { label: "Three numbers as a vector" }],
  ["vector", null, { label: "Null vector" }],
  ["spacing", 8, { label: "One inset" }],
  ["color", "not-a-colour", { label: "Bad colour" }],
  ["color", null, { label: "Null colour" }],
  ["motion", null, { label: "Null motion" }],
  ["bezier", [0.1, 0.7, 0.1, 1], { label: "Bezier array" }],
  ["typography", null, { label: "Null type" }],
  ["image", { gamma: "bright" }, { label: "Odd image" }],
  ["sampler", {}, { label: "Empty sampler" }],
  ["keyframes", [], { label: "No keyframes" }],
  ["nested", { a: [[1, 2], [3, 4]], b: { c: [5, 6, 7] }, d: "text" }, { label: "Nested arrays" }],
  ["list", [], { label: "Empty list" }],
  ["mystery", null, { label: "Mystery null" }],
  ["boolean", "yes", { label: "Truthy text" }],
  ["text", 42, { label: "Number as text value" }],
  ["number", 3, { label: "Bad range", min: "zero", max: 10, step: -1 }],
];
const make = (list, prefix) => list.map(([type, value, extra], i) => ({ id: `${prefix}${i}`, type, label: `${type} ${i}`, value, depth: 1, ...extra }));
/** One section per entry keeps each studio honest; `per` controls share a section. */
export function hostileSchemas(per = 6) {
  const all = [...make(documented, "d"), ...make(hostile, "h")],
    out = [];
  for (let i = 0; i < all.length; i += per) out.push({ sections: [{ id: `s${i}`, label: `Batch ${i / per + 1}`, depth: 2, controls: all.slice(i, i + per) }] });
  return out;
}
export const counts = { documented: documented.length, hostile: hostile.length };
