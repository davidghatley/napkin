// Minimal Parquet v1: required INT32 columns, plain pages, uncompressed row groups.
// Compact Thrift metadata follows parquet-format/src/main/thrift/parquet.thrift.
import { open } from "node:fs/promises";
const v = (n) => {
  n = BigInt(n);
  const b = [];
  do {
    const x = Number(n & 127n);
    n >>= 7n;
    b.push(x | (n ? 128 : 0));
  } while (n);
  return Buffer.from(b);
};
const i = (n) => v((BigInt(n) << 1n) ^ (BigInt(n) >> 63n));
const s = (x) => {
  const b = Buffer.from(x);
  return Buffer.concat([v(b.length), b]);
};
const list = (type, a) =>
  Buffer.concat([
    a.length < 15
      ? Buffer.from([(a.length << 4) | type])
      : Buffer.concat([Buffer.from([240 | type]), v(a.length)]),
    ...a,
  ]);
const struct = (fields) => {
  let last = 0;
  const b = [];
  for (const [id, type, data] of fields) {
    b.push(
      id - last < 16
        ? Buffer.from([((id - last) << 4) | type])
        : Buffer.concat([Buffer.from([type]), i(id)]),
      data,
    );
    last = id;
  }
  return Buffer.concat([...b, Buffer.from([0])]);
};
export async function writeParquet(path, rows, seed = 7) {
  const file = await open(path, "w");
  let offset = 4;
  const groups = [];
  await file.write(Buffer.from("PAR1"));
  try {
    for (let start = 0; start < rows; start += 65536) {
      const n = Math.min(rows - start, 65536),
        chunks = [];
      let size = 0;
      for (const [c, name] of ["id", "value"].entries()) {
        const data = Buffer.alloc(n * 4);
        for (let j = 0; j < n; j++)
          data.writeInt32LE(
            c ? ((start + j) * 31 + seed) % 100003 : start + j,
            j * 4,
          );
        const h = struct([
          [1, 5, i(0)],
          [2, 5, i(data.length)],
          [3, 5, i(data.length)],
          [
            5,
            12,
            struct([
              [1, 5, i(n)],
              [2, 5, i(0)],
              [3, 5, i(3)],
              [4, 5, i(3)],
            ]),
          ],
        ]);
        const bytes = h.length + data.length;
        chunks.push(
          struct([
            [2, 6, i(offset)],
            [
              3,
              12,
              struct([
                [1, 5, i(1)],
                [2, 9, list(5, [i(0), i(3)])],
                [3, 9, list(8, [s(name)])],
                [4, 5, i(0)],
                [5, 6, i(n)],
                [6, 6, i(bytes)],
                [7, 6, i(bytes)],
                [9, 6, i(offset)],
              ]),
            ],
          ]),
        );
        await file.write(h);
        await file.write(data);
        offset += bytes;
        size += bytes;
      }
      groups.push(
        struct([
          [1, 9, list(12, chunks)],
          [2, 6, i(size)],
          [3, 6, i(n)],
        ]),
      );
    }
    const schema = [
      struct([
        [4, 8, s("measurements")],
        [5, 5, i(2)],
      ]),
      ...["id", "value"].map((name) =>
        struct([
          [1, 5, i(1)],
          [3, 5, i(0)],
          [4, 8, s(name)],
        ]),
      ),
    ];
    const metadata = struct([
      [1, 5, i(1)],
      [2, 9, list(12, schema)],
      [3, 6, i(rows)],
      [4, 9, list(12, groups)],
      [6, 8, s("napkin measures CC0")],
    ]);
    const len = Buffer.alloc(4);
    len.writeUInt32LE(metadata.length);
    await file.write(metadata);
    await file.write(len);
    await file.write(Buffer.from("PAR1"));
  } finally {
    await file.close();
  }
}
