// Preload for INV-05 (node --import this-file). Records every write to a .tsx file made through node:fs, with the
// JS stack of the caller, as JSON lines in $NAPKIN_SPY_LOG. It wraps the sync, callback, promise and stream forms.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { resolve } from 'node:path';

const log = process.env.NAPKIN_SPY_LOG;
const append = fs.appendFileSync.bind(fs); // the real one, kept before patching
const isTsx = (p) => typeof p === 'string' || p instanceof URL || Buffer.isBuffer(p) ? String(p instanceof URL ? p.pathname : p).endsWith('.tsx') : false;
const record = (fn, path) => {
  const stack = new Error().stack.split('\n').slice(3).map((l) => l.trim()).join('\n');
  append(log, JSON.stringify({ fn, path: resolve(String(path)), stack }) + '\n');
};
const WRITE_FLAGS = /[wa+]/;
const writes = (flags) => typeof flags === 'number' ? (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_TRUNC)) !== 0 : WRITE_FLAGS.test(String(flags ?? 'r'));

// [function name, which argument is the path being written (0 first, 1 second), extra check on the arguments]
const TARGETS = [
  ['writeFileSync', 0], ['appendFileSync', 0], ['truncateSync', 0], ['renameSync', 1], ['linkSync', 1], ['symlinkSync', 1], ['copyFileSync', 1], ['cpSync', 1],
  ['writeFile', 0], ['appendFile', 0], ['truncate', 0], ['rename', 1], ['link', 1], ['copyFile', 1], ['cp', 1],
  ['unlinkSync', 0], ['rmSync', 0], ['unlink', 0], ['rm', 0], // deleting a component is a write too
];
for (const [name, at] of TARGETS) {
  const orig = fs[name];
  if (typeof orig !== 'function') continue;
  fs[name] = function (...args) { if (isTsx(args[at])) record(name, args[at]); return orig.apply(this, args); };
}
for (const name of ['writeFile', 'appendFile', 'truncate', 'rename', 'link', 'copyFile', 'cp', 'unlink', 'rm']) {
  const at = ['rename', 'link', 'copyFile', 'cp'].includes(name) ? 1 : 0;
  const orig = fs.promises[name];
  if (typeof orig === 'function') fs.promises[name] = function (...args) { if (isTsx(args[at])) record(`promises.${name}`, args[at]); return orig.apply(this, args); };
}
// File descriptors opened on a .tsx: a later write through the descriptor is recorded too.
const fds = new Map();
const openSync = fs.openSync;
fs.openSync = function (path, flags, ...rest) {
  if (isTsx(path) && writes(flags)) record('openSync', path);
  const fd = openSync.call(this, path, flags, ...rest);
  if (isTsx(path)) fds.set(fd, resolve(String(path)));
  return fd;
};
for (const name of ['writeSync', 'write', 'ftruncateSync', 'ftruncate', 'fsyncSync']) {
  const orig = fs[name];
  if (name === 'fsyncSync') continue; // flushing is not a change
  fs[name] = function (fd, ...rest) { if (fds.has(fd)) record(name, fds.get(fd)); return orig.call(this, fd, ...rest); };
}
const closeSync = fs.closeSync;
fs.closeSync = function (fd) { fds.delete(fd); return closeSync.call(this, fd); };
const open = fs.open;
fs.open = function (path, flags, ...rest) { if (isTsx(path) && writes(typeof flags === 'function' ? 'r' : flags)) record('open', path); return open.call(this, path, flags, ...rest); };
const popen = fs.promises.open;
fs.promises.open = function (path, flags, ...rest) { if (isTsx(path) && writes(flags)) record('promises.open', path); return popen.call(this, path, flags, ...rest); };
const cws = fs.createWriteStream;
fs.createWriteStream = function (path, ...rest) { if (isTsx(path)) record('createWriteStream', path); return cws.call(this, path, ...rest); };
syncBuiltinESMExports();
