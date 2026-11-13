// Bench-time randomisation of corpus content. The committed corpus gives the format and
// structure; every colour, duration, envelope, name and byte a viewer must show is chosen here,
// per run, so a viewer that never read the file cannot know them.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { crc32 } from "node:zlib";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, randomInt } from "node:crypto";

const hex2 = (n) => n.toString(16).padStart(2, "0");
export const toHex = (rgb) => "#" + rgb.map(hex2).join("");
export const fromHex = (h) =>
  [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const dist = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));
// Two saturated, mutually distant colours, away from the page backgrounds viewers use.
export function palette2() {
  for (;;) {
    const pick = () =>
      Array.from({ length: 3 }, () => randomInt(0, 6) * 48 + 15);
    const a = pick(),
      b = pick();
    const lum = (c) => (c[0] + c[1] + c[2]) / 3;
    if (dist(a, b) >= 144 && [a, b].every((c) => lum(c) > 40 && lum(c) < 215))
      return [toHex(a), toHex(b)];
  }
}
const ff = (...a) =>
  execFileSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", "-threads", "1", ...a],
    { stdio: "pipe" },
  );
export function storedZip(entries) {
  const files = [],
    central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const n = Buffer.from(name),
      crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(n.length, 26);
    files.push(h, n, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, cd, end]);
}
// Returns { bytes?, text?, expect } for kinds that are re-made at bench time. `ctx` carries one
// palette and one set of numbers per run so cross-file checks stay consistent.
export function randomize(f, bytes, ctx) {
  const [A, B] = ctx.colors,
    a = fromHex(A);
  const expect = {};
  const swap = (s) => s.replaceAll("#f0bd45", A).replaceAll("#154f65", B);
  switch (f.kind) {
    case "svg":
      expect.colors = [A, B];
      expect.animated = true;
      return { bytes: Buffer.from(swap(bytes.toString())), expect };
    case "lottie":
      expect.colors = [A];
      expect.animated = true;
      return {
        bytes: Buffer.from(
          bytes
            .toString()
            .replace(
              "[0.94,0.74,0.27,1]",
              `[${a.map((x) => +(x / 255).toFixed(4)).join(",")},1]`,
            ),
        ),
        expect,
      };
    case "html":
    case "css-animation":
    case "waapi":
      expect.colors = [A];
      expect.animated = f.kind !== "html";
      return { bytes: Buffer.from(swap(bytes.toString())), expect };
    case "tsx":
    case "jsx":
      expect.colors = [A];
      return { bytes: Buffer.from(swap(bytes.toString())), expect };
    case "css":
      f.markers.text = [B];
      return { bytes: Buffer.from(swap(bytes.toString())), expect };
    case "png":
    case "jpg":
    case "webp":
    case "avif": {
      const out = join(ctx.tmp, "still." + f.path.split(".").pop());
      const enc =
        f.kind === "avif"
          ? ["-c:v", "libaom-av1", "-cpu-used", "8", "-still-picture", "1"]
          : f.kind === "jpg"
            ? ["-q:v", "2", "-pix_fmt", "yuvj444p"]
            : [];
      ff(
        "-f",
        "lavfi",
        "-i",
        `color=c=${A.replace("#", "0x")}:s=160x100,drawbox=x=0:y=0:w=80:h=100:color=${B.replace("#", "0x")}:t=fill`,
        "-frames:v",
        "1",
        ...enc,
        out,
      );
      expect.colors = [A, B];
      return { bytes: readFileSync(out), expect };
    }
    case "gif":
    case "apng": {
      const out = join(ctx.tmp, "anim." + (f.kind === "gif" ? "gif" : "apng"));
      ff(
        "-filter_complex",
        `color=c=${A.replace("#", "0x")}:s=160x100:r=5:d=0.6[a];color=c=${B.replace("#", "0x")}:s=160x100:r=5:d=0.4[b];[a][b]concat=n=2:v=1:a=0${f.kind === "gif" ? ",split[x][y];[x]palettegen[p];[y][p]paletteuse" : ""}`,
        ...(f.kind === "apng" ? ["-plays", "0", "-f", "apng"] : []),
        out,
      );
      expect.colors = [A, B];
      expect.animated = true;
      return { bytes: readFileSync(out), expect };
    }
    case "mp4":
    case "webm":
    case "mov": {
      const out = join(ctx.tmp, "clip." + f.kind);
      const half = (ctx.duration / 2).toFixed(2);
      ff(
        "-filter_complex",
        `color=c=${A.replace("#", "0x")}:s=160x100:r=10:d=${half}[a];color=c=${B.replace("#", "0x")}:s=160x100:r=10:d=${half}[b];[a][b]concat=n=2:v=1:a=0`,
        "-an",
        "-c:v",
        f.kind === "webm" ? "libvpx-vp9" : "libx264",
        ...(f.kind === "webm" ? [] : ["-pix_fmt", "yuv420p"]),
        out,
      );
      f.meta.duration = ctx.duration;
      expect.first = A;
      expect.second = B;
      return { bytes: readFileSync(out), expect };
    }
    case "wav":
    case "mp3":
    case "flac":
    case "ogg": {
      // Amplitude ramps from `start` to 1: a waveform must be taller late than early.
      const out = join(ctx.tmp, "tone." + f.kind);
      ff(
        "-f",
        "lavfi",
        "-i",
        `aevalsrc=sin(2*PI*${ctx.frequency}*t)*(${ctx.ramp}+(1-${ctx.ramp})*t/${ctx.duration}):s=44100:d=${ctx.duration}`,
        "-ac",
        "1",
        out,
      );
      f.meta.duration = ctx.duration;
      f.meta.frequency = ctx.frequency;
      expect.ramp = ctx.ramp;
      return { bytes: readFileSync(out), expect };
    }
    case "zip": {
      const name = `note-${ctx.nonce}.txt`,
        body = `Inside ${ctx.nonce} ${ctx.seed}`;
      f.markers.text = [name];
      f.meta.entries = 2;
      expect.entry = { name, body };
      return {
        bytes: storedZip([
          [name, Buffer.from(body)],
          [`pic-${ctx.nonce}.bin`, randomBytes(64)],
        ]),
        expect,
      };
    }
    case "binary": {
      const head = randomBytes(24),
        text = `ORBIT_${ctx.nonce}_USEFUL_STRING`;
      const out = Buffer.concat([head, Buffer.from(text), randomBytes(48)]);
      f.markers.text = [text];
      f.meta.bytes = out.length;
      expect.head = head.subarray(0, 8).toString("hex");
      return { bytes: out, expect };
    }
    case "vega-lite":
    case "chart": {
      const doc = JSON.parse(bytes.toString());
      const rows = ctx.rows();
      if (f.kind === "chart") doc.data = rows;
      else doc.data.values = rows;
      f.meta.marks = rows.length;
      expect.series = rows.map((r) => r.value);
      return { bytes: Buffer.from(JSON.stringify(doc)), expect };
    }
    default:
      return null;
  }
}
export function makeContext(seed, nonce) {
  const tmp = mkdtempSync(join(tmpdir(), "napkin-d3-media-"));
  const rowCount = 19 + (seed % 23);
  return {
    tmp,
    seed,
    nonce,
    colors: palette2(),
    duration: +(1.2 + randomInt(0, 13) / 10).toFixed(1),
    frequency: randomInt(300, 900),
    ramp: +(0.15 + randomInt(0, 20) / 100).toFixed(2),
    rows: () =>
      Array.from({ length: rowCount }, (_, id) => ({
        id,
        label: `orbit-${seed}-${id}`,
        value: seed + id * 31,
        active: id % 2 === 0,
      })),
    clean: () => rmSync(tmp, { recursive: true, force: true }),
  };
}
