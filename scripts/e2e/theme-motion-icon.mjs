/** The shared theme toggle, page-entry motion, and the favicon. */
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
let pass=0,fail=0;const fails=[];
const ck=(n,c,e="")=>c?(pass++,console.log(`  ok    ${n}`)):(fail++,fails.push(`${n} — ${e}`),console.log(`  FAIL  ${n} — ${e}`));
const w=ms=>new Promise(r=>setTimeout(r,ms));
const args=[...chromium.args.filter(a=>!/single-process/.test(a)),"--no-sandbox","--disable-dev-shm-usage"];
const B=process.env.SLATE_BASE||"http://localhost:3000";
const br=await puppeteer.launch({executablePath:await chromium.executablePath(),args,headless:true});
const ROUTES=["/","/problem","/walkthrough","/why-webmcp","/playground"];

console.log("=== the toggle is on every page, in the same place ===");
{
  const boxes=[];
  for(const r of ROUTES){
    const p=await br.newPage(); await p.setViewport({width:1400,height:900});
    await p.goto(B+r,{waitUntil:"domcontentloaded"}); await w(1300);
    const m=await p.evaluate(()=>{
      const b=document.querySelector(".theme-toggle");
      if(!b) return null;
      const r=b.getBoundingClientRect();
      const banner=document.querySelector(".banner").getBoundingClientRect();
      return {top:Math.round(r.top), rightGap:Math.round(banner.right-r.right),
        inBanner:r.top>=banner.top-1&&r.bottom<=banner.bottom+1,
        label:b.textContent.trim(), pressed:b.getAttribute("aria-pressed")};
    });
    ck(`${r} has the toggle`, Boolean(m), "missing");
    if(m){ ck(`${r} — it sits inside the banner`, m.inBanner); boxes.push({r,...m}); }
    await p.close();
  }
  const tops=[...new Set(boxes.map(b=>b.top))];
  ck("it is at the same height on every page", tops.length===1, JSON.stringify(boxes.map(b=>[b.r,b.top])));
  const gaps=[...new Set(boxes.map(b=>b.rightGap))];
  ck("and the same distance from the right edge", gaps.length===1, JSON.stringify(gaps));
}

console.log("\n=== it works, and the choice carries across pages ===");
{
  const p=await br.newPage(); await p.setViewport({width:1400,height:900});
  await p.goto(B+"/problem",{waitUntil:"domcontentloaded"}); await w(1300);
  const before=await p.evaluate(()=>document.documentElement.dataset.theme);
  await p.evaluate(()=>document.querySelector(".theme-toggle").click()); await w(800);
  const after=await p.evaluate(()=>({theme:document.documentElement.dataset.theme,
    stored:localStorage.getItem("slate-theme"),
    pressed:document.querySelector(".theme-toggle").getAttribute("aria-pressed"),
    label:document.querySelector(".theme-toggle__label").textContent.trim()}));
  ck("toggling from a reading page flips the theme", after.theme!==before, `${before} → ${after.theme}`);
  ck("the choice is stored", after.stored===after.theme, String(after.stored));
  ck("aria-pressed follows the state", after.pressed===String(after.theme==="dark"), after.pressed);
  ck("the label names the other option", after.label===(after.theme==="dark"?"Light":"Dark"), after.label);
  // the glyphs crossfade rather than swapping
  const g=await p.evaluate(()=>{
    const sun=getComputedStyle(document.querySelector(".theme-toggle__sun"));
    const moon=getComputedStyle(document.querySelector(".theme-toggle__moon"));
    return {sun:+sun.opacity, moon:+moon.opacity, tr:sun.transitionProperty};
  });
  ck("both glyphs are mounted and crossfade", /opacity/.test(g.tr) && g.sun!==g.moon, JSON.stringify(g));
  await p.goto(B+"/walkthrough",{waitUntil:"domcontentloaded"}); await w(1300);
  ck("the theme carries to the next page", await p.evaluate(()=>document.documentElement.dataset.theme)===after.theme);
  await p.close();
}

console.log("\n=== page entry motion ===");
{
  const p=await br.newPage(); await p.setViewport({width:1400,height:900});
  await p.goto(B+"/problem",{waitUntil:"domcontentloaded"}); await w(1300);
  const m=await p.evaluate(()=>{
    const el=document.querySelector(".page")||document.querySelector(".work");
    const cs=getComputedStyle(el);
    const banner=getComputedStyle(document.querySelector(".banner"));
    return {name:cs.animationName, dur:cs.animationDuration, el:el.className,
      bannerAnim:banner.animationName};
  });
  ck("the content animates in", m.name==="page-in", `${m.name} on .${m.el}`);
  ck("over a short duration", parseFloat(m.dur)>0 && parseFloat(m.dur)<=0.4, m.dur);
  ck("the banner does not animate", m.bannerAnim==="none", m.bannerAnim);
  await p.close();

  const q=await br.newPage(); await q.setViewport({width:1400,height:900});
  await q.emulateMediaFeatures([{name:"prefers-reduced-motion",value:"reduce"}]);
  await q.goto(B+"/problem",{waitUntil:"domcontentloaded"}); await w(1200);
  const rm=await q.evaluate(()=>getComputedStyle(document.querySelector(".page")).animationName);
  ck("reduced motion turns it off", rm==="none", rm);
  await q.close();
}

console.log("\n=== favicon ===");
{
  const res=await fetch(B+"/favicon.ico");
  ck("/favicon.ico is served", res.status===200, `${res.status}`);
  const buf=Buffer.from(await res.arrayBuffer());
  ck("it is a real ICO", buf[0]===0 && buf[1]===0 && buf[2]===1, buf.slice(0,4).toString("hex"));
  const count=buf.readUInt16LE(4);
  ck("it carries several sizes", count>=4, `${count} frames`);
  const icon=await fetch(B+"/icon.png");
  ck("/icon.png is served for modern browsers", icon.status===200, `${icon.status}`);
  const apple=await fetch(B+"/apple-icon.png");
  ck("/apple-icon.png is served", apple.status===200, `${apple.status}`);
  const p=await br.newPage();
  await p.goto(B+"/",{waitUntil:"domcontentloaded"}); await w(900);
  const links=await p.evaluate(()=>[...document.querySelectorAll('link[rel*="icon"]')].map(l=>l.getAttribute("href")));
  ck("the document declares an icon", links.length>0, links.join(","));
  await p.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if(fails.length) console.log("FAILURES:\n - "+fails.join("\n - "));
await br.close();
