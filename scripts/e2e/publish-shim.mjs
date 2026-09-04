/**
 * ?inspect=1 publishes the shim on document.modelContext.
 *
 * The regression this guards against: once the shim is on `document`,
 * `resolveModelContext()` would find it there and report native WebMCP on a
 * browser that has none. The chip must still read `shim`.
 */
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
let pass=0,fail=0;const fails=[];
const ck=(n,c,e="")=>c?(pass++,console.log(`  ok    ${n}`)):(fail++,fails.push(`${n} — ${e}`),console.log(`  FAIL  ${n} — ${e}`));
const w=ms=>new Promise(r=>setTimeout(r,ms));
const args=[...chromium.args.filter(a=>!/single-process/.test(a)),"--no-sandbox","--disable-dev-shm-usage"];
const B=process.env.SLATE_BASE||"http://localhost:3000";
const br=await puppeteer.launch({executablePath:await chromium.executablePath(),args,headless:true});

async function open(url){
  const p=await br.newPage(); await p.setViewport({width:1400,height:1000});
  await p.goto(B+url,{waitUntil:"domcontentloaded"});
  await p.waitForSelector("#op-me",{timeout:20000}); await w(500);
  await p.type("#op-me","Amicia"); await p.type("#op-them","Hugo");
  await p.click("#op-amount",{clickCount:3}); await p.type("#op-amount","1200");
  await p.evaluate(()=>[...document.querySelectorAll("button")].find(b=>/open the slate/i.test(b.textContent))?.click());
  await w(3800);
  await p.evaluate(()=>document.querySelector(".tour .btn--ghost")?.click()); await w(400);
  return p;
}

console.log("=== default: nothing published ===");
{
  const p=await open("/?demo=1");
  const m=await p.evaluate(()=>({published:typeof document.modelContext!=="undefined",
    chip:document.querySelector(".provider-chip")?.textContent?.trim()}));
  ck("document.modelContext is untouched by default", m.published===false, String(m.published));
  ck("the chip reads shim", /shim/i.test(m.chip||""), String(m.chip));
  await p.close();
}

console.log("\n=== ?inspect=1: published, and still honest ===");
{
  const p=await open("/?demo=1&inspect=1");
  const m=await p.evaluate(async()=>{
    const mc=document.modelContext;
    const tools=mc?await mc.getTools():null;
    return {published:Boolean(mc), marked:mc?.isSlateShim===true,
      names:(tools||[]).map(t=>t.name),
      chip:document.querySelector(".provider-chip")?.textContent?.trim(),
      note:Boolean(document.querySelector(".foot__note"))};
  });
  console.log("        discovered:", m.names.join(", ")||"(none)");
  ck("document.modelContext is published", m.published);
  ck("it identifies itself as the polyfill", m.marked, String(m.marked));
  ck("an outside caller can discover the tools", m.names.length>=3, `${m.names.length}`);
  ck("the chip STILL reads shim, not native", /shim/i.test(m.chip||""), String(m.chip));
  ck("the fallback note is still shown", m.note);

  // execute a tool from outside the bundle, the way an extension would
  const out=await p.evaluate(async()=>{
    const mc=document.modelContext;
    const tools=await mc.getTools();
    const t=tools.find(x=>x.name==="get-loan-summary");
    try{ const r=await mc.executeTool(t,{}); return {ok:true,text:(typeof r==="string"?r:JSON.stringify(r)).slice(0,70)}; }
    catch(e){ return {ok:false,text:String(e).slice(0,70)}; }
  });
  ck("an outside caller can execute a tool", out.ok, out.text);
  console.log("        result:", out.text);

  // a closed clause is still closed from outside
  const closed=await p.evaluate(async()=>{
    const mc=document.modelContext;
    const tools=await mc.getTools();
    return tools.some(t=>t.name==="send-reminder");
  });
  ck("a clause-closed tool is absent from outside too", closed===false, String(closed));
  await p.close();
}

console.log("\n=== the playground publishes without being asked ===");
{
  const p=await br.newPage(); await p.setViewport({width:1400,height:1000});
  await p.goto(B+"/playground",{waitUntil:"domcontentloaded"}); await w(2200);
  const m=await p.evaluate(async()=>{
    const mc=document.modelContext;
    const tools=mc?await mc.getTools():[];
    return {published:Boolean(mc), marked:mc?.isSlateShim===true,
      names:tools.map(t=>t.name),
      chip:(document.body.innerText.match(/shim|native/i)||[""])[0]};
  });
  console.log("        discovered:", m.names.join(", ")||"(none)");
  ck("the playground publishes the shim", m.published);
  ck("it is still marked as the polyfill", m.marked);
  ck("its tools are discoverable from outside", m.names.length>=3, `${m.names.length}`);
  ck("it still reports shim, not native", /shim/i.test(m.chip), m.chip);
  await p.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if(fails.length) console.log("FAILURES:\n - "+fails.join("\n - "));
await br.close();
