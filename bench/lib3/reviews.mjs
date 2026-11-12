import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { ROOT, assert, walk } from "./runtime.mjs";
// Evidence must be supplied by the critic/owner, never fabricated by the bench.
export function buildHash() {
  const files = [
    ...walk(join(ROOT, "src")).map((p) => "src/" + p),
    ...walk(join(ROOT, "public")).map((p) => "public/" + p),
  ];
  const h = createHash("sha256");
  for (const p of files.sort()) h.update(p).update(readFileSync(join(ROOT, p)));
  return h.digest("hex");
}
export function reviewEvidence(key) {
  const i = process.argv.indexOf("--reviews");
  assert(
    i >= 0,
    "No independent evidence supplied (--reviews FILE); see bench/README.md",
  );
  const path = resolve(process.argv[i + 1]),
    doc = JSON.parse(readFileSync(path));
  assert(
    doc.sourceHash === buildHash(),
    "Review evidence is for a different product source hash",
  );
  const e = doc[key];
  assert(e, "Missing evidence " + key);
  assert(
    e.reviewer && e.reviewer !== "builder" && e.artifacts?.length,
    "Fresh reviewer identity and artifact paths required",
  );
  for (const a of e.artifacts) {
    const bytes = readFileSync(resolve(path, "..", a.path));
    assert(
      createHash("sha256").update(bytes).digest("hex") === a.sha256,
      "Evidence artifact hash mismatch: " + a.path,
    );
  }
  return e;
}
