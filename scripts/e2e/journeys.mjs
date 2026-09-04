import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
let pass=0,fail=0; const fails=[];
const ck=(n,c,e="")=>c?(pass++,console.log(`  ok    ${n}`)):(fail++,fails.push(`${n} — ${e}`),console.log(`  FAIL  ${n} — ${e}`));
const w=ms=>new Promise(r=>setTimeout(r,ms));
const args=[...chromium.args.filter(a=>!/single-process/.test(a)),"--no-sandbox","--disable-dev-shm-usage"];
const B="http://127.0.0.1:3000"; const errs=[];
const br=await puppeteer.launch({executablePath:await chromium.executablePath(),args,headless:true});
const pg=async(vw=1440)=>{const p=await br.newPage();await p.setViewport({width:vw,height:1000});
  p.on("pageerror",e=>errs.push("pageerror: "+String(e).slice(0,140)));
  p.on("console",m=>{if(m.type()==="error"&&!/403/.test(m.text()))errs.push("console: "+m.text().slice(0,140));});
  return p;};
const click=(p,re)=>p.evaluate((s)=>{const b=[...document.querySelectorAll("button,a")].find(x=>new RegExp(s,"i").test(x.textContent));
  if(b){b.click();return true;} return false;},re.source??re);
const open=async(p,me="Amicia",them="Hugo",amt="1200",demo=false)=>{
  await p.goto(B+(demo?"/?demo=1":"/"),{waitUntil:"domcontentloaded"});
  await p.waitForSelector("#op-me",{timeout:20000}); await w(500);
  await p.type("#op-me",me); await p.type("#op-them",them);
  await p.click("#op-amount",{clickCount:3}); await p.type("#op-amount",amt);
  await click(p,/open the slate/); await w(3500);
};

console.log("=== 1. Entry validation ===");
{
  const p=await pg(); await p.goto(B+"/",{waitUntil:"domcontentloaded"});
  await p.waitForSelector("#op-me",{timeout:20000}); await w(500);
  await click(p,/open the slate/); await w(600);
  const empty=await p.$eval(".entry__warn",e=>e.textContent).catch(()=>null);
  ck("empty form rejected", Boolean(empty), String(empty));
  await p.type("#op-me","A"); await p.type("#op-them","B"); await p.type("#op-amount","1");
  await click(p,/open the slate/); await w(600);
  const low=await p.$eval(".entry__warn",e=>e.textContent).catch(()=>null);
  ck("below-minimum amount rejected", Boolean(low), String(low));
  await p.click("#op-amount",{clickCount:3}); await p.type("#op-amount","abc");
  await click(p,/open the slate/); await w(600);
  const nan=await p.$eval(".entry__warn",e=>e.textContent).catch(()=>null);
  ck("non-numeric amount rejected", Boolean(nan), String(nan));
  // same name both sides
  await p.click("#op-me",{clickCount:3}); await p.type("#op-me","Sam");
  await p.click("#op-them",{clickCount:3}); await p.type("#op-them","Sam");
  await p.click("#op-amount",{clickCount:3}); await p.type("#op-amount","500");
  await click(p,/open the slate/); await w(2500);
  const dup=await p.evaluate(()=>document.body.innerText);
  ck("same name on both halves handled without crashing", !/Application error|Unhandled/.test(dup));
  await p.close();
}

console.log("\n=== 2. Both roles from the landing page ===");
for(const [label,btn,expect] of [["lender","I lent it",/You.re lending/],["borrower","I borrowed it",/is lending you/i]]){
  const p=await pg(); await p.goto(B+"/",{waitUntil:"domcontentloaded"});
  await p.waitForSelector("#op-me",{timeout:20000}); await w(500);
  // The role control is a radio inside a label, not a button.
  await p.evaluate(t=>{const l=[...document.querySelectorAll(".opener__opt")].find(x=>new RegExp(t,"i").test(x.textContent));
    l?.querySelector("input")?.click();}, btn);
  await w(400);
  await p.type("#op-me","Amicia"); await p.type("#op-them","Hugo");
  await p.click("#op-amount",{clickCount:3}); await p.type("#op-amount","1200");
  await click(p,/open the slate/); await w(3500);
  const t=await p.evaluate(()=>document.body.innerText);
  ck(`${label}: workbench opens`, /What \w+ can do/.test(t), t.slice(0,80).replace(/\n/g," "));
  ck(`${label}: summary matches the role`, expect.test(t), (t.match(/(You.re lending[^\n]*|\w+ is lending you[^\n]*)/)||[""])[0]);
  await p.close();
}

console.log("\n=== 3. Every entry path into the demo ===");
{
  // a. landing page "Play the demo"
  const p=await pg(); await p.goto(B+"/",{waitUntil:"domcontentloaded"}); await w(1500);
  const href=await p.evaluate(()=>document.querySelector(".entry__demo a")?.getAttribute("href"));
  ck("landing offers the demo", href==="/?demo=1&autoplay=1", String(href));
  await p.evaluate(()=>document.querySelector(".entry__demo a").click()); await w(6000);
  const a=await p.evaluate(()=>({inWork:!document.querySelector("#op-me"),
    demoOn:Boolean(document.querySelector(".col--demo")),
    playing:/\d+ \/ 17/.test(document.body.innerText)}));
  ck("Play the demo lands in the workbench", a.inWork);
  ck("  ...with the demo layer on", a.demoOn);
  ck("  ...and the simulator ready", a.playing);
  await p.close();

  // b. walkthrough "Play the whole slate"
  const q=await pg(); await q.goto(B+"/walkthrough",{waitUntil:"domcontentloaded"}); await w(900);
  await q.evaluate(()=>{[...document.querySelectorAll("a")].find(x=>/play the whole slate/i.test(x.textContent))?.click();});
  await w(6000);
  const b=await q.evaluate(()=>({url:location.href,demo:Boolean(document.querySelector(".col--demo"))}));
  ck("walkthrough → play lands in demo", /demo=1/.test(b.url)&&b.demo, b.url);
  await q.close();

  // c. walkthrough "Open a slate"
  const r=await pg(); await r.goto(B+"/walkthrough",{waitUntil:"domcontentloaded"}); await w(900);
  await r.evaluate(()=>{[...document.querySelectorAll("a")].filter(x=>/open a slate/i.test(x.textContent)).pop()?.click();});
  await w(2500);
  ck("walkthrough → open a slate reaches the form", await r.evaluate(()=>Boolean(document.querySelector("#op-me"))));
  await r.close();

  // d. direct ?demo=0 stays plain
  const s=await pg(); await s.goto(B+"/?demo=0",{waitUntil:"domcontentloaded"}); await w(1500);
  ck("?demo=0 keeps the demo off", await s.evaluate(()=>!document.querySelector(".col--demo")));
  await s.close();
}

console.log("\n=== 4. Navigation ===");
{
  const p=await pg(); await p.goto(B+"/problem",{waitUntil:"domcontentloaded"}); await w(700);
  for(const [sel,expect] of [['a[href="/walkthrough"]',"/walkthrough"],['a[href="/why-webmcp"]',"/why-webmcp"],['a[href="/playground"]',"/playground"],['a[href="/problem"]',"/problem"]]){
    await p.evaluate(s=>document.querySelector(s)?.click(),sel); await w(1200);
    ck(`nav to ${expect}`, new URL(p.url()).pathname===expect, p.url());
  }
  // Whatever the walk visited second-to-last is where Back should land, so
  // this does not go stale when a page is added to the nav.
  const beforeBack=new URL(p.url()).pathname;
  await p.goBack(); await w(1200);
  const afterBack=new URL(p.url()).pathname;
  ck("browser back works", afterBack!==beforeBack && afterBack.startsWith("/"), `${beforeBack} → ${afterBack}`);
  await p.evaluate(()=>document.querySelector(".wordmark--link, a.wordmark")?.click()); await w(1800);
  ck("wordmark returns home", new URL(p.url()).pathname==="/", p.url());
  await p.close();
}

console.log("\n=== 5. Theme and demo toggles persist ===");
{
  const p=await pg(); await open(p,"Amicia","Hugo","1200",true);
  const before=await p.evaluate(()=>document.documentElement.dataset.theme);
  await click(p,/^(dark|light)$/); await w(700);
  const after=await p.evaluate(()=>document.documentElement.dataset.theme);
  ck("theme flips", before!==after, `${before}->${after}`);
  await p.reload({waitUntil:"domcontentloaded"}); await w(2200);
  ck("theme survives reload", await p.evaluate(()=>document.documentElement.dataset.theme)===after);
  await p.evaluate(()=>document.querySelector(".switch input")?.click()); await w(900);
  ck("demo can be switched off in place", await p.evaluate(()=>!document.querySelector(".col--demo")));
  await p.evaluate(()=>document.querySelector(".switch input")?.click()); await w(900);
  ck("and back on", await p.evaluate(()=>Boolean(document.querySelector(".col--demo"))));
  await p.close();
}

console.log("\n=== 6. Mobile journey (390px) ===");
{
  const p=await pg(390); await open(p,"Amicia","Hugo","1200",true);
  const m=await p.evaluate(()=>({
    inWork:!document.querySelector("#op-me"),
    overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
    nav:document.querySelectorAll(".nav__link").length}));
  ck("mobile: slate opens", m.inWork);
  ck("mobile: no overflow", m.overflow<=1, `${m.overflow}`);
  ck("mobile: nav present", m.nav===4, `${m.nav}`);
  await p.close();
}

console.log("\npage errors:", [...new Set(errs)].join(" | ")||"none");
console.log(`\n${pass} passed, ${fail} failed`);
if(fails.length) console.log("FAILURES:\n - "+fails.join("\n - "));
await br.close();
