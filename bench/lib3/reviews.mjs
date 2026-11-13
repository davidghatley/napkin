import { readFileSync } from "node:fs";
import { createHash, createPublicKey, createPrivateKey, sign, verify } from "node:crypto";
import { join, resolve, sep } from "node:path";
import { ROOT, assert, walk } from "./runtime.mjs";
import { LEAD } from "./lead-env.mjs";
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
//   NAPKIN_LEAD_PUBKEY  the lead's Ed25519 PUBLIC key (PEM text). Entries are signed with the
//                       matching private key by bench/lead-sign.mjs, which only the lead runs.
// The bench holds only the public key, so a product (or anything it can run) that reads the
// bench's environment learns nothing that lets it forge an entry. The variables are also removed
// from every child process the bench starts (cleanEnv in runtime.mjs).
// Absent, unsigned, stale (different product source hash) or hand-written input is "not met".
export function leadAttested(key) {
  const file = LEAD.file,
    pub = LEAD.pub;
  assert(
    file && pub,
    `PENDING LEAD ATTESTATION (${key}): set NAPKIN_LEAD_ATTEST and NAPKIN_LEAD_PUBKEY; see bench/README.md`,
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
  let ok = false;
  try {
    ok =
      typeof mac === "string" &&
      verify(
        null,
        Buffer.from(canonical({ sourceHash: doc.sourceHash, key, entry: body })),
        createPublicKey(pub),
        Buffer.from(mac, "hex"),
      );
  } catch {}
  assert(ok, "Attestation signature invalid");
  return e;
}
// Used by bench/lead-sign.mjs (lead only) and the self-test.
export const signAttestation = (privateKeyPem, sourceHash, key, entry) =>
  sign(
    null,
    Buffer.from(canonical({ sourceHash, key, entry })),
    createPrivateKey(privateKeyPem),
  ).toString("hex");
