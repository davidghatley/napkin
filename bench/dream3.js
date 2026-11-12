#!/usr/bin/env node
// The whole DREAM 3 bar in one run. Sequential by design: no two suites, servers or Chromium
// instances compete. Acceptance needs every registered measure for D1 to D8, the three legacy
// benches and the full test suite, executed in this run. Anything missing, skipped, not run or
// still waiting on lead-attested input blocks acceptance.
//   node bench/dream3.js [--only D1,D4] [--skip-legacy] [--tests] [--out DIR] [--json]
import { spawn } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "./lib3/runtime.mjs";
import { buildHash } from "./lib3/reviews.mjs";
const DIMENSIONS = [
  ["D1", "kinds"],
  ["D2", "controls3"],
  ["D3", "keys3"],
  ["D4", "board"],
  ["D5", "agents3"],
  ["D6", "gen"],
  ["D7", "motion"],
  ["D8", "craft"],
];
const LEGACY = [
  ["fidelity", ["bench/fidelity.js"]],
  ["edits", ["bench/edits.js"]],
  ["imposed", ["bench/imposed.js"]],
];
const arg = (n) => process.argv[process.argv.indexOf(n) + 1];
const only = process.argv.includes("--only") ? arg("--only").split(",") : null;
const passthrough = process.argv
  .slice(2)
  .filter(
    (x, i, a) =>
      !["--json", "--only", "--skip-legacy", "--tests"].includes(x) &&
      a[i - 1] !== "--only",
  );
function exec(args, timeoutMs = 3_600_000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr += b));
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("error", (e) => {
      stderr += e.message;
      clearTimeout(timer);
      resolve({ code: 2, stdout, stderr });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 2, stdout, stderr });
    });
  });
}
const results = [],
  regressions = [];
for (const [dimension, name] of DIMENSIONS) {
  if (only && !only.includes(dimension)) {
    results.push({
      dimension,
      notRun: true,
      beat: { met: 0, total: 1 },
      dream: { met: 0, total: 1 },
      checks: [],
      pendingLead: 0,
    });
    continue;
  }
  const { code, stdout, stderr } = await exec([
    join(ROOT, "bench", name + ".js"),
    "--json",
    ...passthrough,
  ]);
  let result;
  try {
    result = JSON.parse(stdout.trim().split("\n").at(-1));
    if (result.dimension !== dimension || !Array.isArray(result.checks))
      throw Error("summary shape");
  } catch {
    result = {
      dimension,
      beat: { met: 0, total: 1 },
      dream: { met: 0, total: 1 },
      pendingLead: 0,
      checks: [
        {
          id: "harness.process",
          ok: false,
          value: {
            exit: code,
            stderr: stderr.slice(-2000),
            stdout: stdout.slice(-2000),
          },
          target: "bench returns machine summary",
        },
      ],
    };
  }
  if (code > 1)
    result.checks.push({
      id: "harness.exit",
      ok: false,
      value: code,
      target: "no harness crash",
    });
  results.push(result);
  console.log(stdout.trim().split("\n").slice(0, -1).join("\n"));
  if (stderr) console.error(stderr.trim());
}
if (!process.argv.includes("--skip-legacy"))
  for (const [name, args] of LEGACY) {
    const r = await exec(args);
    regressions.push({
      name,
      ok: r.code === 0,
      exit: r.code,
      tail: (r.stdout + r.stderr)
        .trim()
        .split("\n")
        .slice(-2)
        .join(" | ")
        .slice(0, 300),
    });
  }
else
  for (const [name] of LEGACY)
    regressions.push({ name, ok: false, notRun: true });
if (process.argv.includes("--tests")) {
  const r = await exec(["--test", "--test-concurrency=1", "test/"]);
  regressions.push({
    name: "test suite",
    ok: r.code === 0,
    exit: r.code,
    tail: r.stdout.trim().split("\n").slice(-6).join(" | ").slice(0, 300),
  });
} else regressions.push({ name: "test suite", ok: false, notRun: true });

const reasons = [];
for (const r of results) {
  if (r.notRun) reasons.push(`${r.dimension} not run`);
  else {
    const failing = r.checks.filter((c) => !c.ok);
    if (failing.length)
      reasons.push(`${r.dimension}: ${failing.length} check(s) failing`);
    if (r.pendingLead)
      reasons.push(
        `${r.dimension}: ${r.pendingLead} lead-attested gate(s) pending`,
      );
  }
}
for (const g of regressions)
  if (!g.ok) reasons.push(`${g.name} ${g.notRun ? "not run" : "failed"}`);
const accepted = reasons.length === 0;
console.log(
  "\nDREAM 3 scoreboard — CPU Chromium, isolated folders and free ports",
);
console.log(
  `Measured: ${new Date().toISOString()} | Node ${process.version} | product ${buildHash()}`,
);
console.log(
  "Dimension | Beat-the-best met/total | Dream met/total | Lead-attested pending",
);
for (const r of results)
  console.log(
    `${r.dimension} | ${r.notRun ? "not run" : `${r.beat.met}/${r.beat.total} | ${r.dream.met}/${r.dream.total}`} | ${r.pendingLead || 0}`,
  );
console.log("Regression gate | Result");
for (const g of regressions)
  console.log(`${g.name} | ${g.notRun ? "NOT RUN" : g.ok ? "PASS" : "FAIL"}`);
console.log(
  `ACCEPTANCE: ${accepted ? "MET" : "NOT MET"}${reasons.length ? " — " + reasons.join("; ") : ""}`,
);
if (process.argv.includes("--json"))
  console.log(
    JSON.stringify({ dimensions: results, regressions, accepted, reasons }),
  );
process.exitCode = accepted ? 0 : 1;
