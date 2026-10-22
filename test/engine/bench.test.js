// The expensive workloads (bench/perf.js, bench/soak.js) as tests, off by default. Each row writes docs/evidence/<ID>.* when it runs.
//   PERF=1 node --test test/engine/bench.test.js     PRF-01..08 and REL-05
//   SOAK=1 node --test test/engine/bench.test.js     60-second soak (REL-04-60s); the 30-minute one is: node bench/soak.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPerf } from '../../bench/perf.js';
import { runSoak } from '../../bench/soak.js';

test('PRF-01..08 and REL-05: measured browser and engine workload', { skip: process.env.PERF !== '1', timeout: 900000 }, async () => {
  const results = await runPerf();
  for (const r of results) assert.ok(r.pass, `${r.id}: see docs/evidence/${r.id}.txt`);
});

test('REL-04: 60-second canvas + two-agent soak', { skip: process.env.SOAK !== '1', timeout: 180000 }, async () => {
  assert.ok((await runSoak({ duration: 60 })).pass);
});
