/**
 * The clause test, from the model's side.
 *
 * Slate's claim is that a closed clause removes the tool rather than guarding
 * it, so an agent has nothing to call. This drives that with a scripted model:
 * it is handed the discovered tool list, and it tries three tools that the
 * drafting phase does not offer.
 *
 * Note the model only runs during drafting — that is where the negotiators
 * live. There is no model-driven agent on an active loan.
 */
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
const B="http://localhost:3000";
let pass=0,fail=0;const fails=[];
const ck=(n,c,e="")=>c?(pass++,console.log(`  ok    ${n}`)):(fail++,fails.push(`${n} — ${e}`),console.log(`  FAIL  ${n} — ${e}`));
const w=ms=>new Promise(r=>setTimeout(r,ms));
const post=async(b)=>(await fetch(`${B}/api/state`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)})).json();

// A fresh slate, still drafting: payment and collection tools do not exist yet.
const room="FM"+Math.floor(Math.random()*9000);
const o=await post({room,type:"open-room"});const L=o.keys.lender;
console.log("  set up: fresh slate, drafting");

const REPLIES=[
  [{type:"text",text:"They are late. I will nudge them."},
   {type:"tool_use",id:"r1",name:"send-reminder",input:{}}],
  [{type:"text",text:"Then I will declare default."},
   {type:"tool_use",id:"r2",name:"declare-default",input:{acknowledgement:"Hugo"}}],
  [{type:"tool_use",id:"r3",name:"explain-locked-capability",input:{capability:"send-reminder"}}],
  [{type:"text",text:"Understood. Nothing else to do."}],
];
const args=[...chromium.args.filter(a=>!/single-process/.test(a)),"--no-sandbox","--disable-dev-shm-usage"];
const br=await puppeteer.launch({executablePath:await chromium.executablePath(),args,headless:true});
const p=await br.newPage(); await p.setViewport({width:1440,height:1100});
let calls=0; const offered=[];
await p.setRequestInterception(true);
p.on("request",req=>{
  if(!/\/api\/agent$/.test(new URL(req.url()).pathname)||req.method()!=="POST") return void req.continue();
  offered.push((JSON.parse(req.postData()||"{}").tools||[]).map(t=>t.name));
  const content=REPLIES[Math.min(calls,REPLIES.length-1)]; calls++;
  req.respond({status:200,contentType:"application/json",body:JSON.stringify({ok:true,content})});
});
await p.evaluateOnNewDocument(()=>{const real=window.fetch;
  window.fetch=(u,o)=>(String(u).endsWith("/api/agent")&&(!o||o.method!=="POST"))
    ?Promise.resolve(new Response(JSON.stringify({serverKey:true,provider:"anthropic",model:"fake-model"}),
      {status:200,headers:{"Content-Type":"application/json"}})):real(u,o);});
await p.goto(`${B}/?demo=1`,{waitUntil:"domcontentloaded"});
await p.waitForSelector("#op-me",{timeout:20000}); await w(600);
await p.type("#op-me","Amicia"); await p.type("#op-them","Hugo");
await p.click("#op-amount",{clickCount:3}); await p.type("#op-amount","1200");
await p.evaluate(()=>[...document.querySelectorAll("button")].find(b=>/open the slate/i.test(b.textContent))?.click());
await w(4200);
await p.evaluate(()=>document.querySelector(".tour .btn--ghost")?.click()); await w(400);
await p.evaluate(()=>{const s=document.querySelector("select"); if(s){s.value="model";s.dispatchEvent(new Event("change",{bubbles:true}));}});
await w(500);
const started=await p.evaluate(()=>{const b=[...document.querySelectorAll("button")].find(x=>/let the agents|stand-in|play them/i.test(x.textContent));
  if(b&&!b.disabled){b.click();return b.textContent.trim();} return null;});
console.log("  started:", started||"(no agent control on this view)");
await w(13000);
const t=await p.evaluate(()=>({trace:[...document.querySelectorAll(".trace__item")].map(li=>li.innerText.replace(/\n/g," · ").slice(0,95)),
  body:document.body.innerText}));
for(const l of t.trace.slice(0,10)) console.log("        · "+l);
const all=offered.flat();
ck("the model was offered a tool list", offered.length>0, `${offered.length} calls`);
ck("send-reminder is not on the list while drafting",
  offered.length>0 && !offered[0].includes("send-reminder"), (offered[0]||[]).join(","));
ck("declare-default is not on the list while drafting",
  offered.length>0 && !offered[0].includes("declare-default"), (offered[0]||[]).join(","));
  ck("sign-agreement is excluded from the negotiators",
  offered.length>0 && !offered[0].includes("sign-agreement"), (offered[0]||[]).join(","));
ck("the model's attempt at a closed tool is refused",
  /send-reminder|declare-default/i.test(t.trace.join(" ")) && /no such tool|refus|cannot/i.test(t.trace.join(" ")),
  t.trace.join(" | ").slice(0,140));
ck("no reminder reached the ledger", !/sent a reminder|nudged/i.test(t.body.split("Ledger")[1]||""));
console.log(`\n${pass} passed, ${fail} failed`);
if(fails.length) console.log("FAILURES:\n - "+fails.join("\n - "));
await br.close();
