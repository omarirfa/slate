const B="http://127.0.0.1:3000";
const post=async(b)=>{const r=await fetch(`${B}/api/state`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)});
  return {status:r.status,...(await r.json().catch(()=>({})))};};
let pass=0,fail=0;const fails=[];
const ck=(n,c,e="")=>c?(pass++,console.log(`  ok    ${n}`)):(fail++,fails.push(`${n} — ${e}`),console.log(`  FAIL  ${n} — ${e}`));
async function fresh(principal=1200,count=6){
  const room="E"+Math.floor(Math.random()*99999);
  const o=await post({room,type:"open-room"});const L=o.keys.lender,Bk=o.keys.borrower;
  await post({room,type:"propose-terms",role:"lender",key:L,payload:{lenderName:"Amicia",borrowerName:"Hugo",principal,installmentCount:count}});
  await post({room,type:"accept-terms",role:"borrower",key:Bk});
  await post({room,type:"sign-agreement",role:"lender",key:L});
  await post({room,type:"sign-agreement",role:"borrower",key:Bk});
  return {room,L,Bk};
}
console.log("=== settled: pay it off in full ===");
{
  const {room,L,Bk}=await fresh(600,3);
  let st=null;
  for(let i=0;i<3;i++){
    await post({room,type:"advance-clock",role:"lender",key:L,payload:{days:30}});
    const pay=await post({room,type:"log-payment",role:"borrower",key:Bk,payload:{amount:200}});
    ck(`payment ${i+1} logged`, pay.ok===true, pay.message);
    st=await post({room,type:"confirm-payment",role:"lender",key:L});
    ck(`payment ${i+1} confirmed`, st.ok===true, st.message);
  }
  ck("loan reaches settled", /settled/i.test(JSON.stringify(st.state).slice(0,4000))||st.state.events.some(e=>/settled|paid in full|cleared/i.test(e.text)),
     st.state.events.at(-1).text);
  const after=await post({room,type:"send-reminder",role:"lender",key:L});
  ck("nothing can be chased once settled", after.ok===false, after.message);
  const def=await post({room,type:"declare-default",role:"lender",key:L,payload:{acknowledgement:"Hugo"}});
  ck("default impossible once settled", def.ok===false, def.message);
}
console.log("\n=== forgiven: wipe the slate ===");
{
  const {room,L,Bk}=await fresh(1200,6);
  const f=await post({room,type:"forgive-remaining",role:"lender",key:L,payload:{acknowledgement:"1200"}});
  ck("forgiveness works with the exact amount", f.ok===true, f.message);
  ck("it records the full outstanding amount", /1,200/.test(f.message), f.message);
  ck("borrower cannot forgive their own debt", (await post({room,type:"forgive-remaining",role:"borrower",key:Bk,payload:{acknowledgement:"1200"}})).ok===false);
  for(const t of ["send-reminder","declare-default"]){
    const r=await post({room,type:t,role:"lender",key:L,payload:{acknowledgement:"Hugo"}});
    ck(`${t} is gone after forgiveness`, r.ok===false, r.message);
  }
}
console.log("\n=== default: once genuinely earned ===");
{
  const {room,L,Bk}=await fresh(1200,6);
  await post({room,type:"advance-clock",role:"lender",key:L,payload:{days:200}});
  const req=await post({room,type:"request-extension",role:"borrower",key:Bk,payload:{extraDays:14}});
  if(req.ok){
    const blocked=await post({room,type:"declare-default",role:"lender",key:L,payload:{acknowledgement:"Hugo"}});
    ck("default blocked while a request is unanswered", blocked.ok===false, blocked.message);
    await post({room,type:"decline-extension",role:"lender",key:L});
  }
  // The cure period assumes the borrower was actually told, so a reminder has
  // to have been sent before default can be declared.
  const rem=await post({room,type:"send-reminder",role:"lender",key:L});
  ck("a reminder can be sent while overdue", rem.ok===true, rem.message);
  await post({room,type:"advance-clock",role:"lender",key:L,payload:{days:30}});
  const d=await post({room,type:"declare-default",role:"lender",key:L,payload:{acknowledgement:"Hugo"}});
  ck("default succeeds once earned", d.ok===true, d.message);
  ck("state records the default", d.state.defaulted===true, String(d.state.defaulted));
}
console.log("\n=== model mode falls back safely with no key ===");
{
  const cfg=await (await fetch(`${B}/api/agent`)).json();
  ck("agent route reports no server key", cfg.serverKey===false, JSON.stringify(cfg).slice(0,90));
  const r=await fetch(`${B}/api/agent`,{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({system:"x",messages:[{role:"user",content:"hi"}],tools:[]})});
  const body=await r.json().catch(()=>({}));
  ck("a model call without a key fails cleanly, not with a 500", r.status!==500, `${r.status} ${JSON.stringify(body).slice(0,70)}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
if(fails.length) console.log("FAILURES:\n - "+fails.join("\n - "));
