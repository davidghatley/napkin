// Tiny forward FlatBuffers writer for one real Arrow IPC Int32 column. Only sample construction lives here.
class Flat {
  constructor() {
    this.b = Buffer.alloc(4096);
    this.at = 4;
  }
  align(n, extra = 0) {
    while ((this.at + extra) % n) this.at++;
  }
  table(fields) {
    this.align(2);
    const n = Math.max(...fields.map((f) => f[0])) + 1,
      v = this.at;
    this.at += 4 + n * 2;
    this.align(8);
    const p = this.at;
    this.at += 4;
    const slots = {};
    for (const [id, width] of fields) {
      this.align(Math.min(width, 8));
      slots[id] = this.at;
      this.at += width;
      this.b.writeUInt16LE(slots[id] - p, v + 4 + id * 2);
    }
    this.b.writeUInt16LE(4 + n * 2, v);
    this.b.writeUInt16LE(this.at - p, v + 2);
    this.b.writeInt32LE(p - v, p);
    return { p, slots };
  }
  vector(n, stride, alignment = 4) {
    this.align(alignment, 4);
    const p = this.at;
    this.b.writeInt32LE(n, p);
    this.at += 4 + n * stride;
    return p;
  }
  string(s) {
    const b = Buffer.from(s),
      p = this.vector(b.length, 1);
    b.copy(this.b, p + 4);
    this.at++;
    return p;
  }
  ref(slot, target) {
    this.b.writeInt32LE(target - slot, slot);
  }
  finish(root) {
    this.b.writeInt32LE(root, 0);
    this.align(8);
    return this.b.subarray(0, this.at);
  }
}
export function arrowBytes(values = [2, 4, 8, 16, 32, 64, 128, 256]) {
  const data = Buffer.alloc(Math.ceil((values.length * 4) / 8) * 8);
  values.forEach((v, i) => data.writeInt32LE(v, i * 4));
  const m = new Flat(),
    message = m.table([
      [0, 2],
      [1, 1],
      [2, 4],
      [3, 8],
    ]);
  m.b.writeInt16LE(4, message.slots[0]);
  m.b[message.slots[1]] = 3;
  m.b.writeBigInt64LE(BigInt(data.length), message.slots[3]);
  const batch = m.table([
    [0, 8],
    [1, 4],
    [2, 4],
  ]);
  m.b.writeBigInt64LE(BigInt(values.length), batch.slots[0]);
  m.ref(message.slots[2], batch.p);
  const nodes = m.vector(1, 16, 8);
  m.b.writeBigInt64LE(BigInt(values.length), nodes + 4);
  m.ref(batch.slots[1], nodes);
  const buffers = m.vector(2, 16, 8);
  m.b.writeBigInt64LE(0n, buffers + 4);
  m.b.writeBigInt64LE(0n, buffers + 12);
  m.b.writeBigInt64LE(0n, buffers + 20);
  m.b.writeBigInt64LE(BigInt(values.length * 4), buffers + 28);
  m.ref(batch.slots[2], buffers);
  const metadata = m.finish(message.p),
    prefix = Buffer.alloc(8);
  prefix.writeInt32LE(-1);
  prefix.writeInt32LE(metadata.length, 4);
  const f = new Flat(),
    footer = f.table([
      [0, 2],
      [1, 4],
      [3, 4],
    ]);
  f.b.writeInt16LE(4, footer.slots[0]);
  const schema = f.table([[1, 4]]);
  f.ref(footer.slots[1], schema.p);
  const fields = f.vector(1, 4);
  f.ref(schema.slots[1], fields);
  const field = f.table([
    [0, 4],
    [1, 1],
    [2, 1],
    [3, 4],
  ]);
  f.ref(fields + 4, field.p);
  f.b[field.slots[1]] = 1;
  f.b[field.slots[2]] = 2;
  const name = f.string('powers');
  f.ref(field.slots[0], name);
  const type = f.table([
    [0, 4],
    [1, 1],
  ]);
  f.b.writeInt32LE(32, type.slots[0]);
  f.b[type.slots[1]] = 1;
  f.ref(field.slots[3], type.p);
  const blocks = f.vector(1, 24, 8);
  f.ref(footer.slots[3], blocks);
  f.b.writeBigInt64LE(8n, blocks + 4);
  f.b.writeInt32LE(prefix.length + metadata.length, blocks + 12);
  f.b.writeBigInt64LE(BigInt(data.length), blocks + 20);
  const foot = f.finish(footer.p),
    tail = Buffer.alloc(10);
  tail.writeInt32LE(foot.length);
  tail.write('ARROW1', 4);
  return Buffer.concat([Buffer.from('ARROW1\0\0'), prefix, metadata, data, foot, tail]);
}
