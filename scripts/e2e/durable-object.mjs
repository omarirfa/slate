const B="http://127.0.0.1:3000";
const post=async(b)=>{const r=await fetch(`${B}/api/state`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)});
  return {status:r.status,...(await r.json().catch(()=>({})))};};
let pass=0,fail=0;const fails=[];
const ck=(n,c,e="")=>c?(pass++,console.log(`  ok    ${n}`)):(fail++,fails.push(`${n} — ${e}`),console.log(`  FAIL  ${n} — ${e}`));
const room="DO"+Math.floor(Math.random()*9000);
console.log("=== Durable Object storage path ===");
const o=await post({room,type:"open-room"});
ck("open-room mints keys on the DO", Boolean(o.keys?.lender&&o.keys?.borrower), JSON.stringify(o).slice(0,80));
const L=o.keys.lender,Bk=o.keys.borrower;
ck("a room cannot be opened twice", (await post({room,type:"open-room"})).ok===false);
ck("no key is refused 403", (await post({room,type:"propose-terms",role:"lender"})).status===403);
ck("wrong key is refused 403", (await post({room,type:"propose-terms",role:"lender",key:"nope"})).status===403);
ck("cross-role key is refused", (await post({room,type:"propose-terms",role:"lender",key:Bk})).status===403);
const p1=await post({room,type:"propose-terms",role:"lender",key:L,payload:{lenderName:"Amicia",borrowerName:"Hugo",principal:1200}});
ck("propose works", p1.ok===true, p1.message);
ck("ledger names the proposer", /^Amicia proposed/.test(p1.state.events.at(-1).text), p1.state.events.at(-1).text);
ck("proposer cannot accept their own terms", (await post({room,type:"accept-terms",role:"lender",key:L})).ok===false);
ck("borrower accepts", (await post({room,type:"accept-terms",role:"borrower",key:Bk})).ok===true);
ck("cannot sign twice", (await post({room,type:"sign-agreement",role:"lender",key:L})).ok===true
  && (await post({room,type:"sign-agreement",role:"lender",key:L})).ok===false);
const s2=await post({room,type:"sign-agreement",role:"borrower",key:Bk});
ck("both halves signed", s2.state.signatures.lender&&s2.state.signatures.borrower);
// persistence: read it back cold
const got=await (await fetch(`${B}/api/state?room=${room}`)).json();
ck("state persists and reads back", got.state?.terms?.lenderName==="Amicia", JSON.stringify(got).slice(0,80));
ck("GET never leaks half-keys", !JSON.stringify(got).includes(L)&&!JSON.stringify(got).includes(Bk));
// clauses on the DO
await post({room,type:"advance-clock",role:"lender",key:L,payload:{days:35}});
const r1=await post({room,type:"send-reminder",role:"lender",key:L});
const r2=await post({room,type:"send-reminder",role:"lender",key:L});
const r3=await post({room,type:"send-reminder",role:"lender",key:L});
ck("reminder budget enforced on the DO", r1.ok&&r2.ok&&!r3.ok, r3.message);
const def=await post({room,type:"declare-default",role:"lender",key:L,payload:{acknowledgement:"Hugo"}});
ck("default refused before the cure period", def.ok===false, def.message);
const pause=await post({room,type:"request-hardship-pause",role:"borrower",key:Bk});
ck("hardship pause taken without permission", pause.ok===true, pause.message);
ck("reminders off during the pause", (await post({room,type:"send-reminder",role:"lender",key:L})).ok===false);
// SSE stream from the DO
console.log("\n=== live event stream from the DO ===");
const ctrl=new AbortController();
const res=await fetch(`${B}/api/events?room=${room}&role=lender&key=${L}`,{signal:ctrl.signal});
ck("event stream opens", res.status===200 && /event-stream/.test(res.headers.get("content-type")||""),
   `${res.status} ${res.headers.get("content-type")}`);
let got1=false;
const reader=res.body.getReader();
const timer=setTimeout(()=>ctrl.abort(),6000);
post({room,type:"log-payment",role:"borrower",key:Bk,payload:{amount:200}});
try{ const t0=Date.now();
  while(Date.now()-t0<5000){ const {value,done}=await reader.read(); if(done)break;
    const txt=new TextDecoder().decode(value); if(/data:/.test(txt)){got1=true; break;} } }catch{}
clearTimeout(timer); ctrl.abort();
ck("stream delivers events", got1);
console.log(`\n${pass} passed, ${fail} failed`);
if(fails.length) console.log("FAILURES:\n - "+fails.join("\n - "));
