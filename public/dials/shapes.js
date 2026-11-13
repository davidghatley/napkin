// Value shapes. When a control's type is one the library has never seen, its value still says
// what it is: a grid of numbers is a matrix, a list of colours is a palette, a list of numbers
// is a profile, an ISO date is a date. Rows and studios both read the shape from here, so an
// agent can declare `{ type: "lens", value: [[1,0],[0,1]] }` and get a real instrument.
import { esc, W, H } from "./figures.js";

export const builtinTypes = new Set(["number", "range", "angle", "vector", "boolean", "select", "segmented", "text", "color", "gradient", "shadow", "spacing", "typography", "motion", "spring", "bezier", "keyframes", "image", "encoding", "sampler", "seed", "asset", "file"]);
const hexColour = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i,
  fnColour = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(.*\)$/i;
const supports = (v) => !!globalThis.CSS?.supports?.("color", v);
export const isColour = (v) => typeof v === "string" && (hexColour.test(v.trim()) || fnColour.test(v.trim()) || supports(v.trim()));
const strongColour = (v) => typeof v === "string" && (hexColour.test(v.trim()) || fnColour.test(v.trim()));
export const isoDate = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
export const timecode = /^(\d{1,2}):(\d{2}):(\d{2})[:;.](\d{2})$/;
export const isMatrix = (v) =>
  Array.isArray(v) && v.length >= 1 && Array.isArray(v[0]) && v[0].length >= 1 && v.every((r) => Array.isArray(r) && r.length === v[0].length && r.every((x) => typeof x === "number" && Number.isFinite(x)));

/** The shape a value has, for a control whose type the library does not know; null if none. */
export function shapeOf(c, v = c.value) {
  const t = c.type;
  if (v === null || v === undefined) return "empty";
  if (t === "matrix" || isMatrix(v)) return isMatrix(v) ? "matrix" : null;
  if (Array.isArray(v) && v.length && v.every(isColour) && (["palette", "colors", "colours", "swatches"].includes(t) || v.some(strongColour))) return "swatches";
  if (["palette", "colors", "colours", "swatches"].includes(t) && Array.isArray(v)) return "swatches";
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return "tags";
  if (typeof v === "string" && (["date", "datetime", "datetime-local", "time"].includes(t) ? isoDate.test(v) || /^\d{2}:\d{2}/.test(v) : isoDate.test(v))) return "date";
  if (typeof v === "string" && (["url", "link", "href", "uri"].includes(t) || /^https?:\/\/\S+$/i.test(v))) return "url";
  if (typeof v === "string" && timecode.test(v)) return "timecode";
  if (typeof v === "string" && isColour(v) && strongColour(v)) return "colour";
  if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length && Object.values(v).every((x) => typeof x === "boolean")) return "flags";
  if (Array.isArray(v) && v.every((x) => typeof x === "number") && v.length !== 2) return "profile";
  return null;
}

/* ---------- row figures, one well of W x H ---------- */
const A = "var(--d-accent)",
  LINE = "var(--d-rule)",
  INK = "var(--d-text)",
  SOFT = "var(--d-faint)",
  PAPER = "var(--d-surface)";
const f1 = (n) => Number(Number(n).toFixed(2));
const svg = (body) => `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${body}</svg>`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const hostOf = (u) => {
  try {
    return new URL(u).host.replace(/^www\./, "");
  } catch {
    return String(u).replace(/^[a-z]+:\/\//i, "").split(/[/?#]/)[0];
  }
};
export function shapeFigure(shape, c, v) {
  if (shape === "empty")
    return svg(`<circle cx="12" cy="12" r="6.5" fill="none" stroke="${SOFT}" stroke-width="1.5"/><path d="M6.5 17.5L17.5 6.5" stroke="${SOFT}" stroke-width="1.5"/><text x="26" y="15.5" class="d-fig-word" fill="${SOFT}">no value</text>`);
  if (shape === "matrix") {
    const rows = v.slice(0, 6),
      cols = Math.min(12, v[0].length),
      flat = rows.flatMap((r) => r.slice(0, cols)),
      lo = Math.min(...flat),
      hi = Math.max(...flat),
      cw = Math.min(8, (W - 4) / cols),
      ch = Math.min(8, (H - 4) / rows.length),
      x0 = 2,
      y0 = (H - ch * rows.length) / 2;
    let out = "";
    rows.forEach((r, i) =>
      r.slice(0, cols).forEach((x, j) => {
        out += `<rect x="${f1(x0 + j * cw + 0.5)}" y="${f1(y0 + i * ch + 0.5)}" width="${f1(cw - 1)}" height="${f1(ch - 1)}" rx="1" fill="${A}" fill-opacity="${f1(0.08 + 0.92 * ((x - lo) / (hi - lo || 1)))}" stroke="${LINE}" stroke-width=".5"/>`;
      }),
    );
    return svg(out + `<text x="${f1(x0 + cols * cw + 5)}" y="15.5" class="d-fig-word" fill="${SOFT}">${rows.length}×${v[0].length}</text>`);
  }
  if (shape === "swatches") {
    const list = v.slice(0, 8),
      w = (W - 4) / Math.max(1, list.length);
    return svg(list.map((x, i) => `<rect x="${f1(2 + i * w)}" y="3" width="${f1(w - 1.5)}" height="18" rx="2" style="fill:${esc(x)}" stroke="${LINE}" stroke-width=".5"/>`).join("") || `<rect x="2" y="3" width="${W - 4}" height="18" rx="2" fill="none" stroke="${LINE}"/>`);
  }
  if (shape === "tags") {
    let x = 2,
      out = "";
    const shown = v.filter(Boolean);
    for (const [i, t] of shown.entries()) {
      const w = Math.min(30, 8 + String(t).length * 3.2);
      if (x + w > W - 14 && i < shown.length) {
        out += `<text x="${f1(x + 1)}" y="15.5" class="d-fig-word" fill="${SOFT}">+${shown.length - i}</text>`;
        break;
      }
      out += `<rect x="${f1(x)}" y="6" width="${f1(w)}" height="12" rx="6" fill="${i ? "none" : A}" fill-opacity=".14" stroke="${i ? LINE : A}"/>`;
      x += w + 3;
    }
    return svg(out || `<rect x="2" y="6" width="22" height="12" rx="6" fill="none" stroke="${LINE}"/><path d="M13 9v6M10 12h6" stroke="${SOFT}"/>`);
  }
  if (shape === "date") {
    const d = new Date(/T|\d{2}:\d{2}/.test(v) && v.length > 10 ? v : `${v.slice(0, 10)}T12:00:00`),
      ok = !Number.isNaN(+d),
      day = ok ? d.getDate() : "?",
      label = ok ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : String(v).slice(0, 10);
    return svg(
      `<rect x="2.5" y="3.5" width="19" height="18" rx="2" fill="${PAPER}" stroke="${INK}"/><rect x="2.5" y="3.5" width="19" height="5" fill="${A}"/>` +
        `<text x="12" y="18.5" text-anchor="middle" class="d-fig-num" fill="${INK}">${day}</text>` +
        `<text x="26" y="15.5" class="d-fig-word" fill="${INK}">${esc(label)}</text>`,
    );
  }
  if (shape === "url") {
    const host = hostOf(v);
    return svg(
      `<path d="M9 14.5l-1.6 1.6a3 3 0 0 1-4.2-4.2l3-3a3 3 0 0 1 4.2 0M13 9.5l1.6-1.6a3 3 0 0 1 4.2 4.2l-3 3a3 3 0 0 1-4.2 0" fill="none" stroke="${A}" stroke-width="1.5" stroke-linecap="round"/>` +
        `<text x="24" y="15.5" class="d-fig-word" fill="${INK}">${esc(host.length > 11 ? host.slice(0, 10) + "…" : host)}</text>`,
    );
  }
  if (shape === "timecode") return svg(`<text x="2" y="16.5" class="d-pixel-text" fill="${A}">${esc(v)}</text>`);
  if (shape === "colour") return `<span class="d-fig-swatch" style="--swatch:${esc(v)}"><i></i></span>`;
  if (shape === "flags") {
    const e = Object.entries(v).slice(0, 7);
    return svg(e.map(([, on], i) => `<rect x="${3 + i * 10.5}" y="7" width="8" height="10" rx="2" fill="${on ? A : "none"}" stroke="${on ? A : LINE}"/>`).join(""));
  }
  if (shape === "profile") {
    if (!v.length) return svg(`<path d="M3 20.5H${W - 3}" stroke="${LINE}"/><path d="M${W / 2} 8v8M${W / 2 - 4} 12h8" stroke="${SOFT}" stroke-width="1.5"/>`);
    const lo = Math.min(0, ...v),
      hi = Math.max(1e-9, ...v),
      pts = v.map((x, i) => [3 + (i / Math.max(1, v.length - 1)) * (W - 6), 20 - ((x - lo) / (hi - lo || 1)) * 16]);
    const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${f1(x)} ${f1(y)}`).join("");
    return svg(
      `<path d="${d}L${f1(pts.at(-1)[0])} 20.5L3 20.5Z" fill="${A}" fill-opacity=".12"/>` +
        `<path d="${d}" fill="none" stroke="${A}" stroke-width="1.5" stroke-linejoin="round"/>` +
        (v.length <= 16 ? pts.map(([x, y]) => `<circle cx="${f1(x)}" cy="${f1(y)}" r="1.6" fill="${PAPER}" stroke="${INK}"/>`).join("") : ""),
    );
  }
  return "";
}
/** A row's one-line words for a shaped value (the full JSON appears when the field is focused). */
export function shapeSummary(shape, c, v) {
  if (shape === "matrix") return `${v.length}×${v[0].length} matrix`;
  if (shape === "swatches") return `${v.length} ${v.length === 1 ? "colour" : "colours"}: ${v.slice(0, 3).join(", ")}${v.length > 3 ? "…" : ""}`;
  if (shape === "tags") return v.length ? v.join(", ") : "no tags";
  if (shape === "flags") {
    const on = Object.entries(v).filter(([, x]) => x).map(([k]) => k);
    return on.length ? `${on.join(", ")} on` : "all off";
  }
  if (shape === "profile") return v.length ? `${v.length} values, ${Math.min(...v)} to ${Math.max(...v)}` : "no values";
  if (shape === "empty") return "no value";
  if (v && typeof v === "object" && !Array.isArray(v)) return Object.keys(v).join(", ");
  return null;
}
