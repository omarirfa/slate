import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
let pass=0,fail=0; const fails=[];
const ck=(n,c,e="")=>c?(pass++,console.log(`  ok    ${n}`)):(fail++,fails.push(`${n} — ${e}`),console.log(`  FAIL  ${n} — ${e}`));
const w=ms=>new Promise(r=>setTimeout(r,ms));
const args=[...chromium.args.filter(a=>!/single-process/.test(a)),"--no-sandbox","--disable-dev-shm-usage"];
const B="http://localhost:3000"; const errs=[];
const br=await puppeteer.launch({executablePath:await chromium.executablePath(),args,headless:true});
const post=async(bd)=>(await fetch(`${B}/api/state`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(bd)})).json();

async function activeSlate(){
  const room="S4"+Math.floor(Math.random()*9000);
  const o=await post({room,type:"open-room"});
  const L=o.keys.lender,Bk=o.keys.borrower;
  await post({room,type:"propose-terms",role:"lender",key:L,payload:{lenderName:"Amicia",borrowerName:"Hugo",principal:1200}});
  await post({room,type:"accept-terms",role:"borrower",key:Bk});
  await post({room,type:"sign-agreement",role:"lender",key:L});
  await post({room,type:"sign-agreement",role:"borrower",key:Bk});
  return {room,L,Bk};
}

console.log("=== 1. Bank: link an account and move money ===");
{
  const {room,L,Bk}=await activeSlate();
  const p=await br.newPage(); await p.setViewport({width:1440,height:1200});
  p.on("pageerror",e=>errs.push(String(e).slice(0,130)));
  await p.goto(`${B}/?room=${room}&role=borrower&key=${Bk}&demo=1`,{waitUntil:"domcontentloaded"});
  await w(6000);
  await p.evaluate(()=>document.querySelector(".tour .btn--ghost")?.click()); await w(400);
  const frames=p.frames().map(f=>f.url());
  const bf=p.frames().find(f=>/3001/.test(f.url()));
  ck("bank frame is live", Boolean(bf), frames.join(" | "));
  if(bf){
    const inside=await bf.evaluate(()=>({
      origin:location.origin,
      tools:(document.body.innerText.match(/Tools on this page:[^\n]*/)||[""])[0].slice(0,90),
      exposed:(document.body.innerText.match(/Exposed to[^\n]*/)||[""])[0].slice(0,70),
      session:/No session/i.test(document.body.innerText)}));
    console.log(`        ${inside.tools}`);
    console.log(`        ${inside.exposed}`);
    ck("bank is a separate origin", inside.origin==="http://localhost:3001", inside.origin);
    ck("bank registered its tools", /get-balance/.test(inside.tools));
    ck("bank trusts only the app origin", /3000/.test(inside.exposed), inside.exposed);
    ck("bank has a session inside the slate", !inside.session);
  }
  const linked=await p.evaluate(()=>document.body.innerText);
  ck("ledger records the bank link", /linked bank account/i.test(linked));
  // read-only bank tool through the panel
  const ran=await p.evaluate(()=>{const bp=document.querySelector(".bank");
    const b=bp&&[...bp.querySelectorAll("button")].find(x=>/prepare/i.test(x.textContent));
    if(b&&!b.disabled){b.click();return b.textContent.trim();} return b?b.textContent.trim()+" [disabled]":null;});
  await w(2500);
  console.log("        bank action tried:", ran||"(none offered)");
  ck("bank panel offers the borrower a transfer", Boolean(ran), String(ran));
  await p.screenshot({path:"/home/claude/sc-bank.png",fullPage:true});
  await p.close();
}

console.log("\n=== 2. Clause refusals through the UI ===");
{
  const {room,L,Bk}=await activeSlate();
  // move the clock so a payment is overdue, spend the reminder budget
  await post({room,type:"advance-clock",role:"lender",key:L,payload:{days:35}});
  await post({room,type:"send-reminder",role:"lender",key:L});
  await post({room,type:"send-reminder",role:"lender",key:L});
  const p=await br.newPage(); await p.setViewport({width:1440,height:1200});
  await p.goto(`${B}/?room=${room}&role=lender&key=${L}&demo=1`,{waitUntil:"domcontentloaded"});
  await w(5200);
  await p.evaluate(()=>document.querySelector(".tour .btn--ghost")?.click()); await w(400);
  const m=await p.evaluate(()=>{
    const b=[...document.querySelectorAll(".actions__toggle")].find(x=>/closed by a clause/i.test(x.textContent));
    const collapsedFirst=/^Show/i.test(b?.textContent||"");
    const rowsBefore=document.querySelectorAll(".actions--closed li").length;
    b?.click();
    return {toggle:Boolean(b), collapsedFirst, rowsBefore, label:b?.textContent.trim()};
  });
  await w(700);
  const after=await p.evaluate(()=>({
    closed:[...document.querySelectorAll(".actions--closed li")].map(li=>li.innerText.split("\n")[0]),
    reasons:[...document.querySelectorAll(".actions--closed li")].map(li=>li.innerText.split("\n")[1]||"")}));
  ck("a closed-capability toggle exists", m.toggle, m.label);
  ck("it starts collapsed on page load", m.collapsedFirst && m.rowsBefore===0, `${m.label} / ${m.rowsBefore} rows`);
  ck("they expand on request", after.closed.length>0, `${after.closed.length}`);
  const remIdx=after.closed.findIndex(x=>/Nudge/i.test(x));
  ck("the spent reminder is now closed", remIdx>=0, after.closed.join(" | ").slice(0,120));
  if(remIdx>=0) console.log(`        reminder reason: ${after.reasons[remIdx]}`);
  const defIdx=after.closed.findIndex(x=>/Declare default/i.test(x));
  ck("default is closed before the cure period", defIdx>=0);
  if(defIdx>=0) console.log(`        default reason:  ${after.reasons[defIdx]}`);
  await p.close();
}

console.log("\n=== 3. Bad inputs and error states ===");
{
  const p=await br.newPage(); await p.setViewport({width:1200,height:900});
  await p.goto(`${B}/?room=NOPE123&role=lender&key=bogus`,{waitUntil:"domcontentloaded"});
  await w(3000);
  const t=await p.evaluate(()=>document.body.innerText);
  ck("a bogus key does not crash the page", !/Application error|Unhandled|TypeError/.test(t), t.slice(0,90).replace(/\n/g," "));
  await p.goto(`${B}/definitely-not-a-page`,{waitUntil:"domcontentloaded"});
  await w(1200);
  const nf=await p.evaluate(()=>document.body.innerText);
  ck("unknown route shows a 404, not a crash", /404|not be found|not found/i.test(nf), nf.slice(0,70).replace(/\n/g," "));
  await p.close();
  // a second attempt to open the same room must be refused
  const room="DUP"+Math.floor(Math.random()*9000);
  await post({room,type:"open-room"});
  const again=await post({room,type:"open-room"});
  ck("a room cannot be opened twice", again.ok===false, String(again.message));
}

console.log("\npage errors:", [...new Set(errs)].join(" | ")||"none");
console.log(`\n${pass} passed, ${fail} failed`);
if(fails.length) console.log("FAILURES:\n - "+fails.join("\n - "));
await br.close();
