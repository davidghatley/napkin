// Event capture mark → end of the next Chromium software Paint. No presentation/scanout claim.
export async function traceScrub(browser, selector, samples = 50) {
  await browser.eval(
    `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`,
  );
  const point = await browser.eval(
    `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
  );
  await browser.eval(
    `window.dialsTraceCount=0;window.dialsTraceListener=e=>{if(e.target.closest(${JSON.stringify(selector)}))performance.mark('dials-scrub-'+(++window.dialsTraceCount));};document.addEventListener('pointermove',window.dialsTraceListener,true)`,
  );
  let resolveComplete;
  const complete = new Promise((resolve) => (resolveComplete = resolve));
  const unsubscribe = browser.onEvent((e) => {
    if (e.method === "Tracing.tracingComplete")
      resolveComplete(e.params.stream);
  });
  await browser.send("Tracing.start", {
    categories: "devtools.timeline,blink.user_timing",
    transferMode: "ReturnAsStream",
  });
  try {
    await browser.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...point,
      button: "left",
      clickCount: 1,
    });
    for (let i = 0; i < samples; i++) {
      await browser.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: point.x + (i % 2 ? 12 : -12),
        y: point.y,
        buttons: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 22));
    }
    await browser.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...point,
      button: "left",
      clickCount: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
  } finally {
    await browser.send("Tracing.end");
    await browser.eval(
      'document.removeEventListener("pointermove",window.dialsTraceListener,true);delete window.dialsTraceListener',
    );
  }
  const stream = await complete;
  unsubscribe();
  let text = "";
  for (;;) {
    const chunk = await browser.send("IO.read", { handle: stream });
    text += chunk.base64Encoded
      ? Buffer.from(chunk.data, "base64").toString()
      : chunk.data;
    if (chunk.eof) break;
  }
  await browser.send("IO.close", { handle: stream });
  const trace = JSON.parse(text).traceEvents,
    marks = trace.filter((e) => e.name.startsWith("dials-scrub-")),
    paints = trace
      .filter((e) => e.name === "Paint" && e.ph === "X")
      .sort((a, b) => a.ts - b.ts),
    latencies = [];
  for (const mark of marks) {
    const paint = paints.find((e) => e.ts >= mark.ts);
    if (paint) latencies.push((paint.ts + (paint.dur || 0) - mark.ts) / 1000);
  }
  latencies.sort((a, b) => a - b);
  return {
    samples: marks.length,
    painted: latencies.length,
    p95: latencies[Math.floor(latencies.length * 0.95)],
    max: latencies.at(-1),
    milliseconds: latencies,
  };
}
