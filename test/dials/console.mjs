// Print console errors and exceptions while the demo loads and each studio opens.
import { launchChromium } from "../helpers/cdp.js";
import { serve } from "./serve.js";
const server = await serve(), b = await launchChromium({ width: 1440, height: 900 });
const errors = [];
b.onEvent((m) => {
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
});
try {
  await b.goto(server.url);
  await b.waitFor("window.dialsDemo&&dialsDemo.panels.length===6").catch((e) => errors.push(String(e)));
  for (let i = 0; i < 6; i++) {
    await b.eval(`(()=>{const p=dialsDemo.panels[${i}];p.setDepth([...p.sections.keys()][0],3,false);return true})()`).catch((e) => errors.push(String(e)));
    await new Promise((r) => setTimeout(r, 200));
    await b.eval(`(()=>{const p=dialsDemo.panels[${i}];p.setDepth([...p.sections.keys()][0],2,false);return true})()`).catch((e) => errors.push(String(e)));
  }
} finally {
  console.log(errors.length ? errors.join("\n---\n") : "no errors");
  await b.close(); await server.close();
}
