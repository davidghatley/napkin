// Imported first by every bench entry point (through runtime.mjs). Captures the lead's attestation
// inputs once and removes them from process.env, so the product, Chromium and MCP children the
// bench starts afterwards cannot read them. Only bench processes (dream3.js re-passes them on
// purpose) ever see them. The key material is a PUBLIC key; the signing key never reaches a bench.
export const LEAD = {
  file: process.env.NAPKIN_LEAD_ATTEST,
  pub: process.env.NAPKIN_LEAD_PUBKEY,
};
for (const k of ["NAPKIN_LEAD_ATTEST", "NAPKIN_LEAD_PUBKEY", "NAPKIN_LEAD_KEY"])
  delete process.env[k];
export const leadEnv = () => ({
  ...(LEAD.file ? { NAPKIN_LEAD_ATTEST: LEAD.file } : {}),
  ...(LEAD.pub ? { NAPKIN_LEAD_PUBKEY: LEAD.pub } : {}),
});
export const setLeadForSelfTest = (file, pub) => {
  LEAD.file = file;
  LEAD.pub = pub;
};
