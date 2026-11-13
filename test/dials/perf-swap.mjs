// Swap a 200-control panel of 8 mixed types, panel on screen, timed from the start of render()
// to the first frame after it (rAF callback, then the task after paint), 40 repetitions.
// Usage: node test/dials/perf-swap.mjs [reps]. Prints JSON with median, p95 and max.
import { launchChromium } from "../helpers/cdp.js";
import { serve } from "./serve.js";

export const swapProbe = (reps = 40) => `(async()=>{
  const kinds=[
    (i)=>({type:"number",value:i%100,min:0,max:100,unit:"px"}),
    (i)=>({type:"range",value:(i%10)/10,min:0,max:1,step:0.01,figure:"opacity"}),
    (i)=>({type:"angle",value:(i*7)%360,min:0,max:360,unit:"deg"}),
    (i)=>({type:"boolean",value:i%2===0}),
    (i)=>({type:"select",value:"b",options:["a","b","c","d"]}),
    (i)=>({type:"color",value:"oklch(60% .15 "+((i*13)%360)+")"}),
    (i)=>({type:"gradient",value:"linear-gradient(90deg, #3459e2, #b8d7f5)"}),
    (i)=>({type:"motion",value:{mode:"bezier",bezier:[0.2,0.8,0.2,1],duration:300+i}}),
  ];
  const make=(salt)=>({sections:Array.from({length:8},(_,s)=>({id:"s"+s,label:"Group "+s,controls:Array.from({length:25},(_,j)=>{const i=s*25+j;return {id:"c"+i,label:"Control "+i+salt,depth:1,...kinds[i%8](i+salt)}})}))});
  const mount=document.createElement("div");
  mount.style.cssText="position:fixed;left:0;top:0;width:900px;height:100vh;overflow:auto;z-index:9999;background:#fff";
  document.body.append(mount);
  const p=new dialsDemo.Dials(mount);
  p.render(make(0));
  await new Promise(r=>requestAnimationFrame(()=>setTimeout(r)));
  // Proof the panel is really on screen: its box, the element at its middle, and the types it holds.
  const box=mount.getBoundingClientRect(),onTop=mount.contains(document.elementFromPoint(450,300)),
    shown=new Set([...mount.querySelectorAll(".d-row[data-type]")].map(r=>r.dataset.type)).size,
    rows=mount.querySelectorAll(".d-row").length;
  const times=[];
  for(let k=0;k<${reps};k++){
    const schema=make(k%2+1);
    const t=performance.now();
    p.render(schema);
    await new Promise(r=>requestAnimationFrame(()=>setTimeout(r)));
    times.push(performance.now()-t);
  }
  p.destroy();mount.remove();
  const s=[...times].sort((a,b)=>a-b),pick=(q)=>s[Math.min(s.length-1,Math.ceil(q*s.length)-1)];
  return JSON.stringify({reps:s.length,controls:rows,types:shown,width:box.width,height:box.height,onTop,median:+pick(.5).toFixed(1),p95:+pick(.95).toFixed(1),max:+s.at(-1).toFixed(1)});
})()`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = await serve(),
    browser = await launchChromium({ width: 1440, height: 900 });
  try {
    await browser.goto(server.url);
    await browser.waitFor("dialsDemo.panels.length===6");
    for (let run = 0; run < 3; run++) console.log(await browser.eval(swapProbe(Number(process.argv[2]) || 40)));
  } finally {
    await browser.close();
    await server.close();
  }
}
