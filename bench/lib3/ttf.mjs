// Original triangle glyphs. TrueType outlines (not an OTF renamed as TTF).
export function makeTTF() {
  const N = 96,
    tables = {},
    b = (n) => Buffer.alloc(n),
    u16 = (v) => {
      const x = b(2);
      x.writeUInt16BE(v);
      return x;
    };
  const head = b(54);
  head.writeUInt32BE(0x10000);
  head.writeUInt32BE(0x10000, 4);
  head.writeUInt32BE(0x5f0f3cf5, 12);
  head.writeUInt16BE(1000, 18);
  head.writeInt16BE(600, 40);
  head.writeInt16BE(800, 42);
  head.writeUInt16BE(8, 46);
  head.writeInt16BE(2, 48);
  head.writeInt16BE(1, 50);
  tables.head = head;
  const hhea = b(36);
  hhea.writeUInt32BE(0x10000);
  hhea.writeInt16BE(800, 4);
  hhea.writeInt16BE(-200, 6);
  hhea.writeUInt16BE(600, 10);
  hhea.writeInt16BE(600, 16);
  hhea.writeInt16BE(1, 18);
  hhea.writeUInt16BE(N, 34);
  tables.hhea = hhea;
  const maxp = b(32);
  maxp.writeUInt32BE(0x10000);
  maxp.writeUInt16BE(N, 4);
  maxp.writeUInt16BE(3, 6);
  maxp.writeUInt16BE(1, 8);
  maxp.writeUInt16BE(1, 14);
  tables.maxp = maxp;
  tables.hmtx = Buffer.concat(
    Array.from({ length: N }, () => Buffer.concat([u16(600), u16(0)])),
  );
  const glyphs = [],
    loca = b((N + 1) * 4);
  let offset = 0;
  for (let n = 0; n < N; n++) {
    loca.writeUInt32BE(offset, n * 4);
    const g = b(32);
    g.writeInt16BE(1);
    g.writeInt16BE(50, 2);
    g.writeInt16BE(0, 4);
    g.writeInt16BE(500, 6);
    g.writeInt16BE(700, 8);
    g.writeUInt16BE(2, 10);
    g.writeUInt16BE(0, 12);
    g[14] = g[15] = g[16] = 1;
    [50, 450, -250, 0, 0, 700].forEach((v, i) => g.writeInt16BE(v, 17 + i * 2));
    glyphs.push(g);
    offset += g.length;
  }
  loca.writeUInt32BE(offset, N * 4);
  tables.loca = loca;
  tables.glyf = Buffer.concat(glyphs);
  // Two segments: ASCII 32..126 and the required sentinel. glyph 0 is .notdef.
  const sub = b(32);
  [4, 32, 0, 4, 4, 1, 0, 126, 65535, 0, 32, 65535, 65505, 1, 0, 0].forEach(
    (v, i) => sub.writeUInt16BE(v, i * 2),
  );
  const cmap = b(12);
  cmap.writeUInt16BE(1, 2);
  cmap.writeUInt16BE(3, 4);
  cmap.writeUInt16BE(1, 6);
  cmap.writeUInt32BE(12, 8);
  tables.cmap = Buffer.concat([cmap, sub]);
  const names = [
      "Orbit Measures",
      "Regular",
      "Orbit Measures Regular",
      "OrbitMeasures-Regular",
    ],
    ids = [1, 2, 4, 6],
    records = b(6 + names.length * 12),
    strings = [];
  records.writeUInt16BE(names.length, 2);
  records.writeUInt16BE(records.length, 4);
  let at = 0;
  names.forEach((name, n) => {
    const bytes = Buffer.from(name, "utf16le");
    bytes.swap16();
    const p = 6 + n * 12;
    [3, 1, 0x409, ids[n], bytes.length, at].forEach((v, j) =>
      records.writeUInt16BE(v, p + j * 2),
    );
    strings.push(bytes);
    at += bytes.length;
  });
  tables.name = Buffer.concat([records, ...strings]);
  const post = b(32);
  post.writeUInt32BE(0x30000);
  post.writeInt16BE(-100, 8);
  post.writeInt16BE(50, 10);
  tables.post = post;
  const os = b(96);
  os.writeUInt16BE(4);
  os.writeInt16BE(600, 2);
  os.writeUInt16BE(400, 4);
  os.writeUInt16BE(5, 6);
  os.writeUInt32BE(1, 42);
  os.write("ORBT", 58);
  os.writeUInt16BE(64, 62);
  os.writeUInt16BE(32, 64);
  os.writeUInt16BE(126, 66);
  os.writeInt16BE(800, 68);
  os.writeInt16BE(-200, 70);
  os.writeUInt16BE(800, 74);
  os.writeUInt16BE(200, 76);
  os.writeUInt16BE(32, 92);
  tables["OS/2"] = os;
  const tags = Object.keys(tables).sort(),
    header = b(12 + tags.length * 16);
  header.writeUInt32BE(0x10000);
  header.writeUInt16BE(tags.length, 4);
  header.writeUInt16BE(128, 6);
  header.writeUInt16BE(3, 8);
  header.writeUInt16BE(tags.length * 16 - 128, 10);
  const sum = (x) => {
    let s = 0;
    for (let i = 0; i < x.length; i += 4) s = (s + x.readUInt32BE(i)) >>> 0;
    return s;
  };
  let pos = header.length,
    headPos;
  const chunks = [header];
  tags.forEach((tag, n) => {
    let bytes = tables[tag];
    const length = bytes.length;
    bytes = Buffer.concat([bytes, b((4 - (length % 4)) % 4)]);
    const p = 12 + n * 16;
    header.write(tag, p);
    header.writeUInt32BE(sum(bytes), p + 4);
    header.writeUInt32BE(pos, p + 8);
    header.writeUInt32BE(length, p + 12);
    if (tag === "head") headPos = pos;
    pos += bytes.length;
    chunks.push(bytes);
  });
  const font = Buffer.concat(chunks);
  font.writeUInt32BE((0xb1b0afba - sum(font)) >>> 0, headPos + 8);
  return font;
}
