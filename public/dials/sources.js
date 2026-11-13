// Real bytes behind a control. A figure that shows a picture shows the one the host supplied, or
// says plainly that it has none; the library never draws a stand-in under a real file name.
//
// Where bytes come from, in order:
//   1. a file the person chose in the studio (held for the value it was chosen as);
//   2. the host's `source(control, value)` option: a URL, Blob, File, ImageBitmap, canvas or <img>
//      (or a promise of one), or null when it has nothing;
//   3. the control's own `source` in the schema: a URL string or { url, name, type }. On an asset or
//      file control the bytes belong to one file and stop applying when the value names another.
export const baseName = (v) => String(v ?? "").split(/[\\/]/).pop();
const looksImage = (name, type = "") => /^image\//.test(type) || /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i.test(name || "");

/** The schema's source for this control and value, or null when it does not apply. */
export function sourceSpec(c, value) {
  const raw = c?.source;
  if (!raw) return null;
  const spec = typeof raw === "string" ? { url: raw } : raw;
  if (!spec.url) return null;
  const name = spec.name || baseName(spec.url);
  if (["asset", "file"].includes(c.type) && value && baseName(value) !== baseName(name)) return null;
  return { ...spec, name };
}

const done = new WeakMap(); // panel → Map(key → result | null)
const loading = new WeakMap(); // panel → Map(key → Promise)
const chosen = new WeakMap(); // panel → Map(control id → { name, file })
/** Remember a file chosen in a studio, for the value it was chosen as. */
export function holdFile(panel, id, file) {
  if (!chosen.has(panel)) chosen.set(panel, new Map());
  chosen.get(panel).set(id, { name: file.name, file });
  // What was known for this control (often "no bytes") is forgotten, so the file is read next time.
  const known = done.get(panel);
  if (known) for (const k of [...known.keys()]) if (k.startsWith(id + "\u0000")) known.delete(k);
}

// Only a path-valued control's bytes depend on its value; an image adjustment edits one picture.
const keyOf = (c, value) => `${c.id}\u0000${["asset", "file"].includes(c.type) ? String(value ?? "") : ""}\u0000${typeof c.source === "string" ? c.source : c.source?.url || ""}`;

async function toBitmap(x) {
  if (!x) return null;
  if (typeof x === "string") {
    const res = await fetch(x);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return toBitmap(await res.blob());
  }
  if (x instanceof Blob) return { image: await createImageBitmap(x), size: x.size, type: x.type };
  if (typeof ImageBitmap !== "undefined" && x instanceof ImageBitmap) return { image: x };
  if (x instanceof HTMLImageElement) {
    if (!x.complete) await x.decode();
    return { image: x };
  }
  if (x instanceof HTMLCanvasElement || (typeof OffscreenCanvas !== "undefined" && x instanceof OffscreenCanvas)) return { image: x };
  return null;
}

/**
 * The picture for a control's value as { image, name, width, height, size?, type? }, or null when
 * there are no bytes. Returns at once when known; otherwise starts loading, returns undefined, and
 * calls `ready(result)` when the load settles (a failed load becomes null with `.error`).
 */
export function pictureFor(panel, c, value, ready) {
  if (!panel || !c) return null;
  const key = keyOf(c, value);
  if (!done.has(panel)) done.set(panel, new Map());
  if (!loading.has(panel)) loading.set(panel, new Map());
  const known = done.get(panel);
  if (known.has(key)) return known.get(key);
  const held = chosen.get(panel)?.get(c.id);
  const name = held && (!["asset", "file"].includes(c.type) || held.name === baseName(value)) ? held.name : sourceSpec(c, value)?.name || (typeof value === "string" ? baseName(value) : c.label || c.id);
  let job = loading.get(panel).get(key);
  if (!job) {
    job = (async () => {
      let raw = held && name === held.name ? held.file : null;
      if (!raw && typeof panel.options?.source === "function") raw = await panel.options.source(c, value);
      if (!raw) raw = sourceSpec(c, value)?.url || null;
      if (!raw) return null;
      if (raw instanceof Blob && !looksImage(raw.name || name, raw.type)) return { image: null, name, size: raw.size, type: raw.type };
      const got = await toBitmap(raw);
      if (!got) return null;
      return { ...got, name, width: got.image.width, height: got.image.height };
    })().then(
      (r) => r,
      (error) => Object.assign({ unavailable: true, name, error: error.message }, {}),
    );
    loading.get(panel).set(key, job);
    job.then((r) => {
      known.set(key, r?.unavailable ? null : r);
      if (r?.unavailable) known.set(key + "\u0000error", r.error);
      loading.get(panel)?.delete(key);
      ready?.(known.get(key));
    });
  } else if (ready) job.then(() => ready(known.get(key)));
  return undefined;
}
/** Why the last load for this value failed, if it did. */
export const pictureError = (panel, c, value) => done.get(panel)?.get(keyOf(c, value) + "\u0000error") || null;

/**
 * The picture a section works on: an image control's own source, else the bytes of the section's
 * asset or file control for its current value.
 */
export function sectionPicture(panel, section, ready) {
  const controls = section?.controls || [];
  for (const c of [...controls.filter((x) => x.type === "image"), ...controls.filter((x) => ["asset", "file"].includes(x.type))]) {
    const value = panel.get(c.id);
    if (c.type === "image" && !c.source && typeof panel.options?.source !== "function" && !chosen.get(panel)?.get(c.id)) continue;
    if (["asset", "file"].includes(c.type) && !value) continue;
    const got = pictureFor(panel, c, value, ready);
    if (got === undefined || got) return got ? { ...got, control: c } : undefined;
  }
  return null;
}
/** Draw `pic` into a canvas of w × h, cropped to cover, and return the canvas. */
export function coverCanvas(pic, w, h) {
  const cv = Object.assign(document.createElement("canvas"), { width: w, height: h }),
    g = cv.getContext("2d", { willReadFrequently: true }),
    iw = pic.width || pic.image.width,
    ih = pic.height || pic.image.height,
    k = Math.max(w / iw, h / ih);
  g.drawImage(pic.image, (w - iw * k) / 2, (h - ih * k) / 2, iw * k, ih * k);
  return cv;
}
/** Plain words for a missing picture. */
export function missingWords(name, error) {
  return error ? `Could not read ${name}: ${error}.` : `No pixels for ${name || "this image"}: the host has not supplied its bytes. Choose a file to preview it here.`;
}
