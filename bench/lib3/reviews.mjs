import { readFileSync } from "node:fs";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { join, resolve, sep } from "node:path";
import { ROOT, assert, walk } from "./runtime.mjs";
// Source hash of the product under test.
export function buildHash() {
  const files = [
    ...walk(join(ROOT, "src")).map((p) => "src/" + p),
    ...walk(join(ROOT, "public")).map((p) => "public/" + p),
  ];
  const h = createHash("sha256");
  for (const p of files.sort()) h.update(p).update(readFileSync(join(ROOT, p)));
  return h.digest("hex");
}
const canonical = (x) =>
  JSON.stringify(x, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
// Lead-attested input: gates that need a human or a real external run (blind rubric, slop audit,
// real Codex/opencode runs, the GPU smoke through the shared lock). Nothing in the repository can
// satisfy them. The lead supplies two things from outside the repo:
//   NAPKIN_LEAD_ATTEST  path to a JSON document kept outside this repo and its worktrees
//   NAPKIN_LEAD_KEY     the secret the lead signs entries with (HMAC-SHA256 of the canonical
//                       { sourceHash, key, entry } object, hex, stored as entry.mac)
// Absent, unsigned, stale (different product source hash) or hand-written input is "not met".
export function leadAttested(key) {
  const file = process.env.NAPKIN_LEAD_ATTEST,
    secret = process.env.NAPKIN_LEAD_KEY;
  assert(
    file && secret,
    `PENDING LEAD ATTESTATION (${key}): set NAPKIN_LEAD_ATTEST and NAPKIN_LEAD_KEY; see bench/README.md`,
  );
  const path = resolve(file);
  assert(
    !path.startsWith(ROOT + sep) && !path.includes(sep + ".worktrees" + sep),
    "Attestation file must live outside the repository",
  );
  const doc = JSON.parse(readFileSync(path, "utf8"));
  assert(
    doc.sourceHash === buildHash(),
    "Attestation is for a different product source hash",
  );
  const e = doc[key];
  assert(e && typeof e === "object", "No lead attestation for " + key);
  assert(
    e.attestedBy && e.attestedBy !== "builder" && e.at,
    "attestedBy and at required",
  );
  const { mac, ...body } = e;
  const want = createHmac("sha256", secret)
    .update(canonical({ sourceHash: doc.sourceHash, key, entry: body }))
    .digest();
  assert(
    typeof mac === "string" &&
      mac.length === want.length * 2 &&
      timingSafeEqual(Buffer.from(mac, "hex"), want),
    "Attestation signature invalid",
  );
  return e;
}
export const signAttestation = (secret, sourceHash, key, entry) =>
  createHmac("sha256", secret)
    .update(canonical({ sourceHash, key, entry }))
    .digest("hex");
