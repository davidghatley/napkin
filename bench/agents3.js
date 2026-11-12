import { reviewEvidence } from "./lib3/reviews.mjs";
import {
  run,
  assert,
  entry,
  output,
  nonce,
  canonical,
  p95,
  valueFor,
  snapshot,
  sleep,
  waitUntil,
} from "./lib3/runtime.mjs";
import { mcp } from "./lib3/mcp.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
export async function measure() {
  return run("D5", async ({ book, f, s, restart }) => {
    const clients = [];
    let agent,
      person,
      error,
      runId,
      placed = [],
      proposals = [],
      question,
      stepCount = 0;
    const times = [];
    const connect = async (who) => {
      const c = await mcp(s.base, who);
      clients.push(c);
      return c;
    };
    const call = async (name, args) => {
      assert(!error, error);
      return agent.call(name, args);
    };
    const complete = async (label) => {
      await call("add_run_step", {
        run: runId,
        id: "step-" + stepCount,
        label,
        status: "complete",
      });
      stepCount++;
    };
    try {
      try {
        agent = await connect("writer-" + nonce());
        person = await connect("person-" + nonce());
        await agent.call("list_items", {});
      } catch (e) {
        error = e.message;
      }
      await book.check(
        "run.start",
        "MCP starts a durable plan and reads selected items/presence",
        async () => {
          const result = await call("start_run", {
            name: "Orbit " + nonce(),
            plan: Array.from({ length: 30 }, (_, n) => ({
              id: "step-" + n,
              label: "Step " + n,
              status: "pending",
            })),
          });
          runId = result.id ?? result.run?.id;
          assert(runId, "no run id");
          const board = await call("get_board", {});
          assert(Array.isArray(board.selection), "MCP must read selection");
          await complete("Start run");
          await complete("Read selection");
          return { ok: true, value: { runId } };
        },
      );
      for (let n = 0; n < 12; n++)
        await book.check(
          "artifact." + n,
          "MCP places a real artifact; 12 artifacts across 6 kinds",
          async () => {
            assert(runId, "run unavailable");
            const file = f.files.filter((x) =>
              ["html", "svg", "png", "wav", "csv", "md"].includes(x.kind),
            )[n % 6];
            const bytes = readFileSync(join(f.folder, file.path));
            const path = `artifact-${nonce()}-${file.original}`;
            const r = await call("add_artifact", {
              run: runId,
              path,
              content: bytes.toString("base64"),
              encoding: "base64",
              kind: file.kind,
              step: "step-" + stepCount,
            });
            assert(r.ok !== false, "artifact rejected");
            const listed = await call("list_items", {});
            const item = listed.items?.find((x) => x.path === path);
            assert(
              item?.kind === file.kind,
              "artifact not listed with correct kind",
            );
            assert(
              readFileSync(join(f.folder, path)).equals(bytes),
              "artifact bytes differ",
            );
            placed.push(item);
            await complete("Place artifact " + n);
            return { ok: true, value: { id: item.id, kind: item.kind, path } };
          },
        );
      await book.check("group", "MCP groups all 12 run artifacts", async () => {
        assert(placed.length === 12, "need 12 artifacts");
        const id = nonce();
        await call("set_board", {
          groups: [
            { id, name: "Run " + runId, items: placed.map((x) => x.id) },
          ],
          arrange: { by: "run" },
          views: [],
        });
        const b = await call("get_board", {});
        assert(
          b.groups?.some(
            (g) => g.id === id && placed.every((x) => g.items.includes(x.id)),
          ),
          "run group lost artifacts",
        );
        await complete("Group artifacts");
        return { ok: true, value: { group: id } };
      });
      for (let n = 0; n < 5; n++)
        await book.check(
          "control." + n,
          "MCP changes a real instrument and reads revision",
          async () => {
            assert(placed.length, "no artifacts");
            const item = placed[n % placed.length];
            const schema = await call("get_controls", { item: item.id });
            const c = schema.sections?.flatMap((x) => x.controls)[
              n % schema.sections.flatMap((x) => x.controls).length
            ];
            assert(c, "no control");
            const before = snapshot(f.folder),
              value = valueFor(c);
            await call("set_control", {
              item: item.id,
              control: c.id,
              value,
              baseRevision: schema.revision,
            });
            const after = snapshot(f.folder);
            assert(canonical(before) !== canonical(after), "no file changed");
            const got = await call("get_controls", { item: item.id });
            assert(
              canonical(
                got.sections
                  .flatMap((x) => x.controls)
                  .find((x) => x.id === c.id)?.value,
              ) === canonical(value),
              "instrument readback differs",
            );
            await complete("Tune control " + n);
            return { ok: true, value: { item: item.id, control: c.id } };
          },
        );
      for (let n = 0; n < 3; n++)
        await book.check(
          "proposal." + n,
          "proposal is isolated until person answers; answer read over MCP",
          async () => {
            assert(runId, "no run");
            const path = "proposal-" + nonce() + ".txt",
              text = "Review " + nonce(),
              before = snapshot(f.folder);
            const p = await call("propose", {
              run: runId,
              path,
              content: text,
            });
            assert(p.id ?? p.proposal, "proposal id absent");
            const id = p.id ?? p.proposal;
            assert(
              canonical(before) === canonical(snapshot(f.folder)),
              "proposal wrote before review",
            );
            await person.call("resolve_proposal", {
              proposal: id,
              outcome: n === 1 ? "rejected" : "accepted",
              comment: "Review " + nonce(),
            });
            const events = await call("read_events", {});
            assert(
              JSON.stringify(events).includes(id),
              "agent did not read person answer",
            );
            if (n !== 1)
              assert(
                readFileSync(join(f.folder, path), "utf8") === text,
                "accepted proposal not on disk",
              );
            else
              assert(
                canonical(before) === canonical(snapshot(f.folder)),
                "rejected proposal wrote file",
              );
            proposals.push(id);
            await complete("Raise proposal " + n);
            await complete("Read proposal answer " + n);
            return {
              ok: true,
              value: { id, outcome: n === 1 ? "rejected" : "accepted" },
            };
          },
        );
      await book.check(
        "question",
        "MCP asks, waits, reads exact person answer",
        async () => {
          const text = "Answer " + nonce();
          question = await call("ask_question", {
            run: runId,
            text: "Which orbit?",
            options: ["gold", "blue"],
          });
          const id = question.id ?? question.question;
          assert(id, "no question id");
          await person.call("answer_question", { question: id, answer: text });
          const events = await call("read_events", {});
          assert(JSON.stringify(events).includes(text), "answer lost");
          await complete("Ask question");
          await complete("Read answer");
          return { ok: true, value: { id, answer: text } };
        },
      );
      await book.check(
        "checkpoint.resume",
        "resume after server restart preserves run steps, artifacts and answers",
        async () => {
          assert(runId, "run missing");
          await complete("Checkpoint");
          const before = await call("get_run", { run: runId });
          await call("checkpoint_run", {
            run: runId,
            label: "Checkpoint " + nonce(),
          });
          for (const c of clients) await c.stop();
          clients.length = 0;
          s = await restart();
          agent = await connect("resumed-" + nonce());
          const after = await call("get_run", { run: runId });
          for (const key of [
            "plan",
            "steps",
            "artifacts",
            "questions",
            "proposals",
          ])
            assert(
              before[key] !== undefined &&
                canonical(before[key]) === canonical(after[key]),
              "restart changed or omitted " + key,
            );
          await call("resume_run", { run: runId });
          await complete("Resume");
          return { ok: true, value: { runId, steps: stepCount } };
        },
      );
      await book.check(
        "writers.concurrent",
        "4 concurrent writers, 0 lost or clobbered accepted edits",
        async () => {
          assert(runId, "no run");
          const writers = await Promise.all(
              Array.from({ length: 4 }, (_, n) =>
                connect("writer-" + n + "-" + nonce()),
              ),
            ),
            expected = [];
          const seen = [];
          let collecting = true,
            pollError;
          const collect = (async () => {
            while (collecting) {
              try {
                const value = await agent.call("read_events", {});
                seen.push({
                  at: performance.now(),
                  value: JSON.stringify(value),
                });
              } catch (e) {
                pollError = e;
                break;
              }
              await sleep(10);
            }
          })();
          try {
            await Promise.all(
              writers.map(async (w, n) => {
                for (let i = 0; i < 10; i++) {
                  const text = `${n}:${i}:${nonce()}`,
                    path = `writer-${n}-${i}-${nonce()}.txt`,
                    t = performance.now();
                  await w.call("add_artifact", {
                    run: runId,
                    path,
                    content: text,
                    encoding: "utf8",
                    kind: "txt",
                  });
                  expected.push({ path, text });
                  const event = await waitUntil(async () => {
                    assert(!pollError, pollError?.message);
                    return seen.find((e) => e.value.includes(path));
                  }, 2000);
                  times.push(event.at - t);
                }
              }),
            );
          } finally {
            collecting = false;
            await collect;
          }
          const got = await call("list_items", {});
          for (const x of expected) {
            assert(
              got.items.some((i) => i.path === x.path),
              "accepted artifact not listed " + x.path,
            );
            assert(
              readFileSync(join(f.folder, x.path), "utf8") === x.text,
              "lost file " + x.path,
            );
          }
          // Same file, independent controls, optimistic retries: unique artifacts alone do not prove no clobbers.
          const item = placed[0];
          assert(item, "no shared item");
          const schema = await call("get_controls", { item: item.id }),
            controls = schema.sections.flatMap((x) => x.controls).slice(0, 4);
          assert(
            controls.length === 4,
            "shared-writer probe needs four independent controls",
          );
          const values = controls.map(valueFor);
          await Promise.all(
            writers.map(async (w, n) => {
              for (let retry = 0; retry < 20; retry++) {
                const schema = await w.call("get_controls", { item: item.id });
                try {
                  await w.call("set_control", {
                    item: item.id,
                    control: controls[n].id,
                    value: values[n],
                    baseRevision: schema.revision,
                  });
                  return;
                } catch (e) {
                  if (!/stale|revision|conflict/i.test(e.message)) throw e;
                }
              }
              throw Error("writer exhausted revision retries");
            }),
          );
          const final = await call("get_controls", { item: item.id });
          for (let n = 0; n < 4; n++)
            assert(
              canonical(
                final.sections
                  .flatMap((x) => x.controls)
                  .find((c) => c.id === controls[n].id)?.value,
              ) === canonical(values[n]),
              "clobbered shared control",
            );
          return {
            ok: true,
            value: { writers: 4, accepted: 40, sharedControls: 4, lost: 0 },
          };
        },
      );
      await book.check(
        "events.latency",
        "≥30 matched edit events; p95 <100 ms",
        () => ({
          ok: times.length >= 30 && p95(times) < 100,
          value: { samples: times.length, p95: p95(times) },
        }),
      );
      await book.check(
        "script.30",
        "30-step scripted run, all preceding operations pass",
        async () => {
          assert(runId, "no run");
          const run = await call("get_run", { run: runId });
          return {
            ok:
              stepCount === 30 &&
              Array.isArray(run.steps) &&
              run.steps.filter((x) => x.status === "complete").length === 30 &&
              book.rows.every((x) => x.ok),
            value: { completed: stepCount, persisted: run.steps?.length },
          };
        },
      );
      await book.check(
        "real.codex-opencode",
        "two real harnesses complete README proving task unaided",
        () => {
          const e = reviewEvidence("agents");
          return {
            ok:
              e.codex?.unaided === true &&
              e.codex?.completed === true &&
              e.opencode?.unaided === true &&
              e.opencode?.completed === true,
            value: e,
          };
        },
      );
    } finally {
      for (const c of clients) await c.stop();
    }
  });
}
if (entry(import.meta.url)) output(await measure());
