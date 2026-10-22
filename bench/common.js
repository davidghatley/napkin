import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from '../test/helpers/harness.js';

export const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)];
export const stats = (samples) => ({ n: samples.length, p50: percentile(samples, .5), p95: percentile(samples, .95), max: Math.max(...samples), samples });
export const rssMB = (pid) => Number(readFileSync(`/proc/${pid}/status`, 'utf8').match(/^VmRSS:\s+(\d+)/m)[1]) / 1024;
const MEASURED = ['src/server.js', 'src/workspace.js', 'src/bundle.js', 'src/store.js', 'src/api.js', 'src/canvas-client.js', 'src/codecs.js', 'src/tsx/read.js', 'src/tsx/write.js', 'public/canvas/main.js', 'public/canvas/stage.js', 'public/canvas/panel.js', 'public/canvas/view.js', 'bench/common.js', 'bench/corpus.js', 'bench/perf.js', 'bench/soak.js', 'test/helpers/cdp.js', 'test/helpers/harness.js'];
export const sourceHashes = () => Object.fromEntries(MEASURED.filter((f) => existsSync(join(ROOT, f))).map((file) => [file, createHash('sha256').update(readFileSync(join(ROOT, file))).digest('hex')]));
export const machine = () => ({ at: new Date().toISOString(), node: process.version, chromium: execFileSync(process.env.CHROMIUM || 'chromium', ['--version'], { encoding: 'utf8' }).trim(), os: `${platform()} ${release()}`, cpu: cpus()[0].model, logicalCPUs: cpus().length, gpu: false });
export function record(id, result, summary, command, { dir = join(ROOT, 'docs/evidence') } = {}) {
  mkdirSync(dir, { recursive: true });
  const data = { id, command, machine: machine(), sourceHashes: sourceHashes(), ...result };
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(data, null, 2) + '\n');
  writeFileSync(join(dir, `${id}.txt`), `${id}\n${summary}\n\nRe-run: ${command}\nMeasured: ${data.machine.at}\n${data.machine.node}; ${data.machine.chromium}; CPU only\nRaw samples and method: docs/evidence/${id}.json\n`);
  console.log(`${id}: ${summary}`);
  return data;
}
export function trackErrors(browser) {
  const errors = [];
  browser.onEvent((m) => {
    if (m.method === 'Runtime.exceptionThrown') errors.push({ at: Date.now(), type: 'exception', detail: m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text });
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push({ at: Date.now(), type: 'console', detail: m.params.args.map((a) => a.value ?? a.description).join(' ') });
  });
  return errors;
}
// The corpus's cell count (bench/corpus.js: three shapes of 3, 6 and 8 cells... per three components).
export const cellCount = (size) => { const remainder = size % 3; return Math.floor(size / 3) * 17 + (remainder === 1 ? 3 : remainder === 2 ? 9 : 0); };
// Every component drawn: every section ready, every cell mounted, no error cards.
export const allDrawn = (size) => `document.body.dataset.ready === '1' && document.querySelectorAll('section.cmp[data-ready="1"]').length === ${size} && document.querySelectorAll('section.cmp .cell').length === ${cellCount(size)} && [...document.querySelectorAll('.cell')].every(e=>e.querySelector('.mount [data-n="root"]')) && ![...document.querySelectorAll('.build-error,.mount .error')].some(e=>e.textContent)`;
