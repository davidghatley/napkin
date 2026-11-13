const c = (id, type, label, value, extra = {}) => ({
  id,
  type,
  label,
  value,
  depth: 1,
  ...extra,
});
const section = (id, label, controls, extra = {}) => ({
  revision: "demo-1",
  sections: [{ id, label, depth: 2, controls, ...extra }],
});
export const samples = [
  {
    id: "color",
    title: "Color",
    file: "brand.css",
    schema: section("pigment", "Pigment", [
      c("ink", "color", "Accent", "oklch(58% .21 265)", {
        default: "#3459e2",
        background: "#ffffff",
        figure: "color",
      }),
      c("opacity", "range", "Opacity", 1, {
        min: 0,
        max: 1,
        step: 0.01,
        figure: "opacity",
      }),
      c(
        "gradient",
        "gradient",
        "Wash",
        "linear-gradient(120deg, #3459e2, #b8d7f5)",
      ),
      c("shadow", "shadow", "Lift", {
        x: 0,
        y: 8,
        blur: 24,
        spread: 0,
        color: "#10204433",
      }),
    ]),
  },
  {
    id: "typography",
    title: "Typography",
    file: "specimen.woff2",
    schema: section("type", "Type", [
      c(
        "typeface",
        "typography",
        "Specimen",
        {
          text: "The shape of\nthings to come.",
          family: '"Dials Inter", system-ui',
          size: 32,
          weight: 550,
          tracking: -1,
          lineHeight: 1.12,
          axes: { wght: 550 },
        },
        {
          scrub: "size",
          axes: [
            { tag: "wght", label: "Weight", min: 100, max: 900, default: 550 },
          ],
        },
      ),
      c("align", "segmented", "Align", "left", {
        options: ["left", "center", "right"],
        figure: "align",
      }),
      c("spacing", "spacing", "Insets", [16, 24, 16, 24]),
      c("copy", "text", "Caption", "A field guide to forms."),
    ]),
  },
  {
    id: "motion",
    title: "Motion",
    file: "entrance.css",
    schema: section("time", "Time", [
      c(
        "ease",
        "motion",
        "Response",
        {
          mode: "spring",
          bezier: [0.22, 0.8, 0.22, 1],
          duration: 1200,
          delay: 120,
          stiffness: 170,
          damping: 14,
          mass: 1,
          velocity: 0,
          keyframes: [
            { time: 0, value: 0 },
            { time: 0.4, value: 0.8 },
            { time: 1, value: 1 },
          ],
        },
        { scrub: "damping" },
      ),
      c(
        "path",
        "keyframes",
        "Path",
        [
          { offset: 0, transform: "translateX(0px)", opacity: 0 },
          { offset: 0.55, transform: "translateX(132px)", opacity: 1 },
          { offset: 1, transform: "translateX(108px)", opacity: 1 },
        ],
        { unit: "px", min: -40, max: 240, property: "transform" },
      ),
      c("rotation", "angle", "Rotation", 30, {
        min: -180,
        max: 180,
        step: 1,
        unit: "deg",
      }),
      c("loop", "boolean", "Loop", true, { figure: "loop" }),
    ]),
  },
  {
    id: "image",
    title: "Image",
    file: "still-life.png",
    schema: section("darkroom", "Darkroom", [
      c(
        "levels",
        "image",
        "Levels",
        {
          black: 0.02,
          white: 0.98,
          gamma: 1.08,
          exposure: 0,
          saturation: 1,
          curve: [0, 0.25, 0.5, 0.75, 1],
          cropLeft: 0,
          cropTop: 0,
          cropRight: 0,
          cropBottom: 0,
          mask: 0,
        },
        { scrub: "gamma", step: 0.01 },
      ),
      c("radius", "number", "Corners", 12, {
        min: 0,
        max: 64,
        step: 1,
        unit: "px",
        figure: "radius",
      }),
      c("asset", "asset", "Source", "still-life.png"),
      c("enabled", "boolean", "Adjustments", true, { figure: "split" }),
    ]),
  },
  {
    id: "data",
    title: "Data",
    file: "observations.csv",
    schema: section("shelf", "Encoding", [
      c(
        "channels",
        "encoding",
        "Fields",
        {
          x: "distance",
          y: "energy",
          color: "group",
          size: "mass",
          mark: "point",
        },
        {
          fields: ["distance", "energy", "group", "mass"],
          data: Array.from({ length: 32 }, (_, i) => ({
            distance: i + 1,
            energy: 10 + i * 1.4 + Math.sin(i * 1.7) * 12,
            group: ["A", "B", "C"][i % 3],
            mass: 2 + ((i * 7) % 11),
          })),
        },
      ),
      c("mark", "segmented", "Mark", "point", {
        figure: "mark",
        options: [
          { label: "Points", value: "point" },
          { label: "Bars", value: "bar" },
          { label: "Line", value: "line" },
        ],
      }),
      c("pointSize", "range", "Point size", 5, {
        min: 1,
        max: 20,
        step: 1,
        unit: "px",
      }),
      c("labels", "boolean", "Labels", false, { figure: "labels" }),
    ]),
  },
  {
    id: "generation",
    title: "Generation",
    file: "portrait.workflow.json",
    schema: section("sampler", "Sampler", [
      c(
        "sampling",
        "sampler",
        "Schedule",
        {
          steps: 28,
          cfg: 7,
          shift: 1,
          scheduler: "karras",
          seed: 51654,
          locked: true,
          denoise: 1,
        },
        { scrub: "steps" },
      ),
      c("seed", "seed", "Variation", 51654, {
        min: 0,
        max: 4294967295,
        step: 1,
      }),
      c("batch", "number", "Batch", 4, { min: 1, max: 16, step: 1, figure: "count" }),
      c("prompt", "text", "Prompt", "A small world in cobalt and paper."),
    ]),
  },
];
export const gallery = section("geometry", "Geometry", [
  c("number", "number", "Radius", 12, {
    min: 0,
    max: 100,
    step: 1,
    unit: "px",
    figure: "radius",
  }),
  c("range", "range", "Opacity", 0.7, {
    min: 0,
    max: 1,
    step: 0.01,
    figure: "opacity",
  }),
  c("vector", "vector", "Position", [0.3, 0.7], { min: 0, max: 1, step: 0.01 }),
  c("angle", "angle", "Rotation", 45, {
    min: 0,
    max: 360,
    step: 1,
    unit: "deg",
  }),
  c("boolean", "boolean", "Visible", true),
  c("select", "select", "Blend", "normal", {
    options: ["normal", "multiply", "screen"],
  }),
  c("segmented", "segmented", "Axis", "x", { options: ["x", "y", "z"] }),
  c("text", "text", "Name", "Untitled"),
  c("gradient", "gradient", "Fill", "linear-gradient(90deg, #3459e2, #ee5228)"),
  c("shadow", "shadow", "Shadow", {
    x: 2,
    y: 4,
    blur: 12,
    spread: 0,
    color: "#0004",
  }),
  c("spacing", "spacing", "Padding", [8, 16, 8, 16]),
  c("seed", "seed", "Seed", 42, { min: 0, max: 4294967295, step: 1 }),
  c("file", "file", "File", ""),
]);
/**
 * A panel the library was never written for: a stage lamp. Types it knows (vector, angle,
 * shadow, spacing, seed, range, segmented, text) and one it does not ("dmx-universe"), which
 * still gets a row figure and a studio from its value alone.
 */
export const lampRig = {
  revision: "lamp-1",
  sections: [
    {
      id: "lamp",
      label: "Lamp rig",
      depth: 2,
      controls: [
        c("aim", "vector", "Aim", [0.3, -0.4], { min: -1, max: 1, step: 0.01 }),
        c("tilt", "angle", "Tilt", 35, { min: -90, max: 90, step: 1, unit: "deg" }),
        c("glow", "shadow", "Glow", { x: 0, y: 0, blur: 32, spread: 4, color: "#ffc85a99" }),
        c("housing", "spacing", "Housing pad", [8, 12, 8, 12]),
        c("noise", "seed", "Noise seed", 1234, { min: 0, max: 99999, step: 1 }),
        c("kelvin", "range", "Colour temperature", 4200, { min: 1800, max: 9000, step: 100, unit: "K" }),
        c("mode", "segmented", "Mode", "spot", { options: [{ label: "Spot", value: "spot" }, { label: "Wash", value: "wash" }, { label: "Strobe", value: "strobe" }] }),
        c("dmx", "dmx-universe", "DMX universe", { start: 1, channels: [255, 180, 40, 0, 128, 64, 220, 12], master: 0.8, enabled: true, name: "Front left" }),
        c("cue", "text", "Cue note", "Slow rise on the second verse, then hold until the lights in the house come down."),
      ],
    },
  ],
};
