# 0019 measures: lead attestation uses a public key

Status: accepted (lane: measures, round 3)

## Context
Judged gates (blind rubric, slop audit, real harness runs) are signed by the lead. The first
design used an HMAC secret in `NAPKIN_LEAD_KEY`, read by the bench process. The bench starts
the product under test, so the secret was in the product's environment and a product could sign
its own attestation.

## Decision
Entries are signed with an Ed25519 private key that only the lead holds (`bench/lead-sign.mjs`).
The bench verifies with the public key (`NAPKIN_LEAD_PUBKEY`, PEM text). Both variables are also
removed from `process.env` at start-up so children do not inherit them. Node's built-in
`crypto` is used: no new dependency.

## Consequences
Anything the product can read (environment, process list, files) no longer lets it forge an
entry. The lead must run `bench/lead-sign.mjs` from a checkout of the exact source being judged.
