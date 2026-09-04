/** The playground: tools by hand, and by a scripted model. */
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
let pass=0,fail=0;const fails=[];
const ck=(n,c,e="")=>c?(pass++,console.log(`  ok    ${n}`)):(fail++,fails.push(`${n} — ${e}`),console.log(`  FAIL  ${n} — ${e}`));
const w=ms=>new Promise(r=>setTimeout(r,ms));
const args=[...chromium.args.filter(a=>!/single-process/.test(a)),"--no-sandbox","--disable-dev-shm-usage"];
const B="http://localhost:3000";
const br=await puppeteer.launch({executablePath:await chromium.executablePath(),args,headless:true});
const errs=[];

console.log("=== by hand ===");
const p=await br.newPage(); await p.setViewport({width:1400,height:1100});
p.on("pageerror",e=>errs.push(String(e).slice(0,140)));
await p.goto(B+"/playground",{waitUntil:"domcontentloaded"}); await w(2000);
const init=await p.evaluate(()=>({
  tools:[...document.querySelectorAll(".play__tools li .mono")].map(e=>e.textContent),
  options:[...(document.querySelectorAll(".play__field--grow select")[0]?.options||[])].map(o=>o.value),
  closedNote:(document.body.innerText.match(/closed by a clause[^\n]*/)||[""])[0].slice(0,90),
}));
console.log("        registered:", init.tools.join(", "));
ck("tools are registered on the page", init.tools.length>=3, `${init.tools.length}`);
ck("the tool picker lists them", init.options.length===init.tools.length, `${init.options.length}`);
ck("closed capabilities are named as not registered", /closed by a clause/.test(init.closedNote), init.closedNote);

// a read tool
await p.evaluate(()=>{const s=document.querySelectorAll(".play__field--grow select")[0];
  s.value="get-loan-summary"; s.dispatchEvent(new Event("change",{bubbles:true}));});
await w(300);
await p.evaluate(()=>[...document.querySelectorAll("button")].find(b=>/execute tool/i.test(b.textContent))?.click());
await w(1200);
let log=await p.evaluate(()=>[...document.querySelectorAll(".play__line")].map(l=>l.innerText.replace(/\n/g," · ").slice(0,80)));
console.log("        "+log.join("\n        "));
ck("a read tool executes and returns", log.some(l=>/^ok/.test(l)), log.join(" | ").slice(0,100));

// bad JSON
await p.evaluate(()=>{const t=document.querySelector(".play__args");
  const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set;
  setter.call(t,"{not json"); t.dispatchEvent(new Event("input",{bubbles:true}));});
await w(300);
await p.evaluate(()=>[...document.querySelectorAll("button")].find(b=>/execute tool/i.test(b.textContent))?.click());
await w(800);
log=await p.evaluate(()=>[...document.querySelectorAll(".play__line")].map(l=>l.innerText.replace(/\n/g," · ")));
ck("invalid JSON is refused, not thrown", log.some(l=>/not valid JSON/i.test(l)), log.at(-1)||"");

// Switching role changes the surface. On a blank slate both halves can do the
// same three things, so propose terms first: only the other side can accept.
await p.evaluate(()=>{const s=document.querySelectorAll(".play__field--grow select")[0];
  s.value="propose-terms"; s.dispatchEvent(new Event("change",{bubbles:true}));});
await w(300);
await p.evaluate(()=>{const t=document.querySelector(".play__args");
  const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set;
  setter.call(t,'{"principal":900,"installmentCount":3}'); t.dispatchEvent(new Event("input",{bubbles:true}));});
await w(300);
await p.evaluate(()=>[...document.querySelectorAll("button")].find(b=>/execute tool/i.test(b.textContent))?.click());
await w(1500);
const asLender=await p.evaluate(()=>[...document.querySelectorAll(".play__tools li .mono")].map(e=>e.textContent).join(","));
ck("the lender who proposed cannot accept their own terms", !asLender.includes("accept-terms"), asLender);
await p.evaluate(()=>{const s=document.querySelector(".play__row select");
  s.value="borrower"; s.dispatchEvent(new Event("change",{bubbles:true}));});
await w(1500);
const asBorrower=await p.evaluate(()=>[...document.querySelectorAll(".play__tools li .mono")].map(e=>e.textContent).join(","));
ck("the other half is offered accept-terms", asBorrower.includes("accept-terms"), asBorrower);
ck("switching role changes the registered set", asBorrower!==asLender, `${asLender} → ${asBorrower}`);
await p.close();

console.log("\n=== by model (scripted) ===");
const q=await br.newPage(); await q.setViewport({width:1400,height:1100});
q.on("pageerror",e=>errs.push(String(e).slice(0,140)));
const REPLIES=[
  [{type:"text",text:"I will read the slate first."},
   {type:"tool_use",id:"a",name:"get-loan-summary",input:{}}],
  [{type:"tool_use",id:"b",name:"seize-collateral",input:{}}],
  [{type:"text",text:"Nothing further."}],
];
let calls=0; const offered=[];
await q.setRequestInterception(true);
q.on("request",req=>{
  if(!/\/api\/agent$/.test(new URL(req.url()).pathname)||req.method()!=="POST") return void req.continue();
  offered.push((JSON.parse(req.postData()||"{}").tools||[]).map(t=>t.name));
  const content=REPLIES[Math.min(calls,REPLIES.length-1)]; calls++;
  req.respond({status:200,contentType:"application/json",body:JSON.stringify({ok:true,content})});
});
await q.goto(B+"/playground",{waitUntil:"domcontentloaded"}); await w(2000);
await q.evaluate(()=>{const t=[...document.querySelectorAll("textarea")].pop();
  const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set;
  setter.call(t,"Read the slate, then take the collateral."); t.dispatchEvent(new Event("input",{bubbles:true}));});
await w(300);
await q.evaluate(()=>[...document.querySelectorAll("button")].find(b=>/^send$/i.test(b.textContent.trim()))?.click());
await w(6000);
const mlog=await q.evaluate(()=>[...document.querySelectorAll(".play__line")].map(l=>l.innerText.replace(/\n/g," · ").slice(0,88)));
console.log("        "+mlog.join("\n        "));
ck("the model was called", calls>0, `${calls}`);
ck("it was handed only registered tools", offered[0]&&!offered[0].includes("seize-collateral"), (offered[0]||[]).join(","));
ck("its real call executed", mlog.some(l=>/^ok/.test(l)));
ck("its fabricated call was refused", mlog.some(l=>/refused/.test(l)&&/seize-collateral|not registered/i.test(l)),
   mlog.join(" | ").slice(0,110));

// a key that is not recognised
await q.evaluate(()=>{const i=document.querySelector('input[type="password"]');
  const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;
  setter.call(i,"totally-not-a-key"); i.dispatchEvent(new Event("input",{bubbles:true}));});
await w(500);
ck("an unrecognised key is called out", /Unrecognised key format/i.test(await q.evaluate(()=>document.body.innerText)));
await q.evaluate(()=>{const i=document.querySelector('input[type="password"]');
  const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;
  setter.call(i,"sk-ant-abc123"); i.dispatchEvent(new Event("input",{bubbles:true}));});
await w(500);
ck("a key's provider is detected", /Detected anthropic/i.test(await q.evaluate(()=>document.body.innerText)));
const stored=await q.evaluate(()=>JSON.stringify({ls:{...localStorage},ss:{...sessionStorage}}));
ck("the key is never written to storage", !/sk-ant-abc123/.test(stored), stored.slice(0,80));
await q.close();

console.log("\npage errors:", [...new Set(errs)].join(" | ")||"none");
console.log(`\n${pass} passed, ${fail} failed`);
if(fails.length) console.log("FAILURES:\n - "+fails.join("\n - "));
await br.close();
