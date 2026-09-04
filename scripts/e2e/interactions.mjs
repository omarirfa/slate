import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
let pass=0,fail=0; const fails=[];
const ck=(n,c,e="")=>c?(pass++,console.log(`  ok    ${n}`)):(fail++,fails.push(`${n} — ${e}`),console.log(`  FAIL  ${n} — ${e}`));
const w=ms=>new Promise(r=>setTimeout(r,ms));
const args=[...chromium.args.filter(a=>!/single-process/.test(a)),"--no-sandbox","--disable-dev-shm-usage"];
const B="http://127.0.0.1:3000"; const errs=[];
const br=await puppeteer.launch({executablePath:await chromium.executablePath(),args,headless:true});
const pg=async(vw=1440)=>{const p=await br.newPage();await p.setViewport({width:vw,height:1100});
  p.on("pageerror",e=>errs.push("pageerror: "+String(e).slice(0,140)));
  p.on("console",m=>{if(m.type()==="error"&&!/403|fonts/.test(m.text()))errs.push("console: "+m.text().slice(0,140));});
  return p;};
const clickBtn=(p,re)=>p.evaluate(s=>{const b=[...document.querySelectorAll("button")].find(x=>new RegExp(s,"i").test(x.textContent));
  if(b&&!b.disabled){b.click();return true;} return false;},re);
const openDemo=async(p)=>{
  await p.goto(B+"/?demo=1",{waitUntil:"domcontentloaded"});
  await p.waitForSelector("#op-me",{timeout:20000}); await w(500);
  await p.type("#op-me","Amicia"); await p.type("#op-them","Hugo");
  await p.click("#op-amount",{clickCount:3}); await p.type("#op-amount","1200");
  await clickBtn(p,"open the slate"); await w(3800);
  await p.evaluate(()=>document.querySelector(".tour .btn--ghost")?.click()); await w(400);
};

console.log("=== 1. Simulator: step, play, stop, all 17 ===");
{
  const p=await pg(); await openDemo(p);
  const count=()=>p.evaluate(()=>(document.body.innerText.match(/(\d+) \/ 17/)||[])[1]);
  ck("starts at 0", await count()==="0", String(await count()));
  await clickBtn(p,"^Step$"); await w(2200);
  const afterStep=await count();
  ck("Step advances one", Number(afterStep)>=1, String(afterStep));
  await clickBtn(p,"^Play$"); await w(3000);
  await clickBtn(p,"^Stop$"); await w(1200);
  const stopped=await count();
  // Stop is a reset, not a pause — Simulate has a separate Pause control.
  ck("Stop resets the run to the start", stopped==="0", String(stopped));
  await clickBtn(p,"^Play$");
  // Sample while it plays: the refusal line only shows for the step it belongs to.
  let refusalsSeen=0;
  let last="0", stable=0;
  for(let i=0;i<70;i++){ await w(1000); const c=await count();
    const r=await p.evaluate(()=>{const e=document.querySelector("[data-refused]");
      return e&&e.getAttribute("data-refused")==="true"?e.textContent.slice(0,40):null;});
    if(r) refusalsSeen++;
    if(c===last){stable++; if(stable>6) break;} else {stable=0; last=c;}
    if(c==="17") break; }
  ck("plays through all 17 steps", last==="17", `stopped at ${last}`);
  const body=await p.evaluate(()=>document.body.innerText);
  ck("refusals were observed during the run", refusalsSeen>0, `${refusalsSeen} sampled`);
  ck("ledger recorded the run", /Show \d+ earlier entr/.test(body)||/day \d+/.test(body));
  ck("no page errors during the run", errs.length===0, errs.slice(0,2).join(" | "));
  await p.screenshot({path:"/home/claude/sc-played.png",fullPage:true});
  await p.close();
}

console.log("\n=== 2. Guided tour: full traversal, keyboard, reopen ===");
{
  const p=await pg();
  await p.goto(B+"/?demo=1",{waitUntil:"domcontentloaded"});
  await p.waitForSelector("#op-me",{timeout:20000}); await w(500);
  await p.type("#op-me","Amicia"); await p.type("#op-them","Hugo");
  await p.click("#op-amount",{clickCount:3}); await p.type("#op-amount","1200");
  await clickBtn(p,"open the slate"); await w(4200);
  ck("tour opens by itself", await p.evaluate(()=>Boolean(document.querySelector(".tour"))));
  const titles=[];
  for(let i=0;i<8;i++){
    const t=await p.evaluate(()=>document.querySelector(".tour__title")?.textContent);
    if(!t) break; titles.push(t);
    const ring=await p.evaluate(()=>{const r=document.querySelector(".tour__ring");
      return r?{w:Math.round(r.getBoundingClientRect().width),h:Math.round(r.getBoundingClientRect().height)}:null;});
    if(ring) ck(`  step ${titles.length} rings something real`, ring.w>20&&ring.h>20, JSON.stringify(ring));
    const more=await p.evaluate(()=>{const b=[...document.querySelectorAll(".tour button")].find(x=>/next|done/i.test(x.textContent));
      if(b){b.click(); return true;} return false;});
    if(!more) break; await w(750);
  }
  console.log("        "+titles.join(" → "));
  ck("tour has several steps", titles.length>=4, `${titles.length}`);
  ck("tour closes at the end", await p.evaluate(()=>!document.querySelector(".tour")));
  ck("reopen button appears", await p.evaluate(()=>Boolean(document.querySelector(".tour__reopen"))));
  await p.evaluate(()=>document.querySelector(".tour__reopen").click()); await w(700);
  ck("tour reopens", await p.evaluate(()=>Boolean(document.querySelector(".tour"))));
  await p.keyboard.press("ArrowRight"); await w(600);
  const t2=await p.evaluate(()=>document.querySelector(".tour__title")?.textContent);
  ck("arrow key advances", t2!==titles[0], String(t2));
  await p.keyboard.press("Escape"); await w(500);
  ck("Escape closes it", await p.evaluate(()=>!document.querySelector(".tour")));
  await p.close();
}

console.log("\n=== 3. Negotiator ===");
{
  const p=await pg(); await openDemo(p);
  const ran=await clickBtn(p,"let the agents");
  ck("negotiator can be started", ran);
  await w(9000);
  const m=await p.evaluate(()=>({trace:document.querySelectorAll(".trace__item").length,
    body:document.body.innerText}));
  ck("negotiation produced moves", m.trace>0 || /proposal/i.test(m.body), `${m.trace} trace rows`);
  ck("no errors from the negotiator", errs.length===0, errs.slice(0,2).join(" | "));
  await p.close();
}

console.log("\n=== 4. Two devices: invite, presence, live updates ===");
{
  const a=await pg(1200);
  await a.goto(B+"/?demo=1",{waitUntil:"domcontentloaded"});
  await a.waitForSelector("#op-me",{timeout:20000}); await w(500);
  await a.type("#op-me","Amicia"); await a.type("#op-them","Hugo");
  await a.click("#op-amount",{clickCount:3}); await a.type("#op-amount","1200");
  await clickBtn(a,"open the slate"); await w(3800);
  await a.evaluate(()=>document.querySelector(".tour .btn--ghost")?.click()); await w(400);
  const invite=await a.evaluate(async()=>{
    let cap=null;
    Object.defineProperty(navigator,"clipboard",{value:{writeText:async t=>{cap=t;}},configurable:true});
    [...document.querySelectorAll("button")].find(b=>/copy invite/i.test(b.textContent))?.click();
    await new Promise(r=>setTimeout(r,400)); return cap;});
  ck("invite produced", Boolean(invite));
  ck("invite carries one half-key", (String(invite).match(/key=/g)||[]).length===1);
  const b2=await pg(1200);
  await b2.goto(String(invite).replace("localhost","127.0.0.1"),{waitUntil:"domcontentloaded"});
  await w(3200);
  const second=await b2.evaluate(()=>({url:location.href, body:document.body.innerText}));
  ck("second device opens the borrower's view", /What Hugo can do/.test(second.body),
     (second.body.match(/What \w+ can do[^\n]*/)||[""])[0]);
  ck("key stripped from its address bar", !/[?&]key=/.test(second.url), second.url);
  // borrower accepts; lender should see it
  await b2.evaluate(()=>{[...document.querySelectorAll("button")].find(x=>/accept/i.test(x.textContent))?.click();});
  await w(4500);
  const lender=await a.evaluate(()=>document.body.innerText);
  ck("the other device's move reaches the opener", /accepted the terms/i.test(lender));
  const presence=await a.evaluate(()=>document.querySelector(".presence")?.textContent||"");
  ck("presence updates", !/hasn.t opened/i.test(presence), presence.trim().slice(0,50));
  await a.close(); await b2.close();
}

console.log("\npage errors:", [...new Set(errs)].join(" | ")||"none");
console.log(`\n${pass} passed, ${fail} failed`);
if(fails.length) console.log("FAILURES:\n - "+fails.join("\n - "));
await br.close();
