// Loaded into every test process and every server/MCP child they start (NODE_OPTIONS=--import, see package.json).
// 1. Temp folders made with mkdtemp under a napkin- prefix are removed when the process exits.
// 2. A child whose parent has died (killed test runner) exits instead of running on, so nothing leaks.
// Leaks used to fill /tmp's inode limit and break every program on the machine (2026-10-21).
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const made = new Set();
const mkdtempSync = fs.mkdtempSync;
fs.mkdtempSync = function (prefix, ...rest) {
  const dir = mkdtempSync.call(this, prefix, ...rest);
  if (/[\\/]napkin-[^\\/]*$/.test(prefix)) made.add(dir);
  return dir;
};
syncBuiltinESMExports();

const clean = () => { for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } made.clear(); };
process.on('exit', clean);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { clean(); process.exit(128 + ({ SIGINT: 2, SIGTERM: 15, SIGHUP: 1 })[sig]); });
}

const parent = process.ppid;
setInterval(() => { if (process.ppid !== parent) { clean(); process.exit(1); } }, 1000).unref();
