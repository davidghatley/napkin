// Lead-only tool: signs one attestation entry. The builder and the bench never hold the private key.
//   node bench/lead-sign.mjs --keygen <dir>                     writes lead.key (private) and lead.pub
//   node bench/lead-sign.mjs --key lead.key --file attest.json --name <gate> --by lead --json '{"...":1}'
// Run it from a checkout of the product source being judged: the entry is bound to buildHash().
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { join } from "node:path";
import { buildHash, signAttestation } from "./lib3/reviews.mjs";
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
if (process.argv.includes("--keygen")) {
  const dir = arg("--keygen");
  mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(join(dir, "lead.key"), privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  writeFileSync(join(dir, "lead.pub"), publicKey.export({ type: "spki", format: "pem" }));
  console.log("wrote lead.key (keep secret) and lead.pub (export as NAPKIN_LEAD_PUBKEY)");
} else {
  const file = arg("--file"), name = arg("--name");
  if (!file || !name || !arg("--key")) throw Error("need --key, --file and --name");
  const h = buildHash();
  const doc = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  if (doc.sourceHash && doc.sourceHash !== h) for (const k of Object.keys(doc)) delete doc[k];
  doc.sourceHash = h;
  const entry = { attestedBy: arg("--by", "lead"), at: new Date().toISOString().slice(0, 10), ...JSON.parse(arg("--json", "{}")) };
  doc[name] = { ...entry, mac: signAttestation(readFileSync(arg("--key"), "utf8"), h, name, entry) };
  writeFileSync(file, JSON.stringify(doc, null, 2));
  console.log(`signed ${name} for source ${h.slice(0, 12)}`);
}
