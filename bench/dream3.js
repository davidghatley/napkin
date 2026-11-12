#!/usr/bin/env node
// Sequential by design: no two suites, servers, or Chromium instances compete.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "./lib3/runtime.mjs";
import { buildHash } from "./lib3/reviews.mjs";
const names = [
    "kinds",
    "controls3",
    "keys3",
    "board",
    "agents3",
    "gen",
    "motion",
  ],
  results = [];
for (const [index, name] of names.entries()) {
  const child = spawn(
    process.execPath,
    [
      join(ROOT, "bench", name + ".js"),
      "--json",
      ...process.argv.slice(2).filter((x) => x !== "--json"),
    ],
    { cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (b) => (stdout += b));
  child.stderr.on("data", (b) => (stderr += b));
  const code = await new Promise((resolve) => {
    child.on("error", (e) => {
      stderr += e.message;
      resolve(2);
    });
    child.on("exit", resolve);
  });
  let result;
  try {
    result = JSON.parse(stdout.trim().split("\n").at(-1));
    if (result.dimension !== `D${index + 1}` || !Array.isArray(result.checks))
      throw Error("summary shape");
  } catch {
    result = {
      dimension: `D${index + 1}`,
      beat: { met: 0, total: 1 },
      dream: { met: 0, total: 1 },
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
console.log(
  "\nDREAM 3 baseline — CPU Chromium, isolated folders and free ports",
);
console.log(
  `Measured: ${new Date().toISOString()} | Node ${process.version} | product ${buildHash()}`,
);
console.log("Dimension | Beat-the-best met/total | Dream met/total");
for (const r of results)
  console.log(
    `${r.dimension} | ${r.beat.met}/${r.beat.total} | ${r.dream.met}/${r.dream.total}`,
  );
if (process.argv.includes("--json"))
  console.log(JSON.stringify({ dimensions: results }));
process.exitCode = results.some((r) => r.checks.some((c) => !c.ok)) ? 1 : 0;
