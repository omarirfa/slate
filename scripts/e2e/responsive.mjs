/**
 * Layout across resolutions and orientations.
 *
 * Checks three things per size: nothing overflows the viewport horizontally,
 * no element is physically wider than the screen, and no navigation link has
 * wrapped onto a second line (which is what a header that "breaks" looks like
 * in the DOM).
 */
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
let pass=0,fail=0; const fails=[];
const ck=(n,c,e="")=>c?(pass++,console.log(`  ok    ${n}`)):(fail++,fails.push(`${n} — ${e}`),console.log(`  FAIL  ${n} — ${e}`));
const w=ms=>new Promise(r=>setTimeout(r,ms));
const args=[...chromium.args.filter(a=>!/single-process/.test(a)),"--no-sandbox","--disable-dev-shm-usage"];
const B=process.env.SLATE_BASE||"http://localhost:3000";

const SIZES=[
  [280,650,"very narrow (side panel)"],
  [320,568,"iPhone SE portrait"],
  [390,844,"iPhone portrait"],
  [844,390,"iPhone landscape"],
  [600,960,"small tablet portrait"],
  [768,1024,"iPad portrait"],
  [1024,768,"iPad landscape"],
  [1280,800,"laptop"],
  [1920,1080,"desktop"],
  [2560,1440,"wide"],
];
const ROUTES=["/","/problem","/walkthrough","/why-webmcp","/playground"];

const br=await puppeteer.launch({executablePath:await chromium.executablePath(),args,headless:true});
for(const [vw,vh,label] of SIZES){
  let bad=[];
  for(const r of ROUTES){
    const p=await br.newPage(); await p.setViewport({width:vw,height:vh});
    await p.goto(B+r,{waitUntil:"domcontentloaded"}); await w(1100);
    const m=await p.evaluate(()=>{
      const de=document.documentElement;
      const over=[];
      for(const el of document.querySelectorAll("body *")){
        const b=el.getBoundingClientRect();
        if(b.width>0&&(b.right>de.clientWidth+1||b.left<-1))
          over.push((el.tagName+"."+String(el.className||"").split(" ")[0]).slice(0,34));
      }
      // a nav link that has wrapped is taller than roughly one line
      const wrapped=[...document.querySelectorAll(".nav__link")].filter(a=>{
        const cs=getComputedStyle(a); const lh=parseFloat(cs.lineHeight)||18;
        return a.getBoundingClientRect().height > lh*1.6;
      }).map(a=>a.textContent.trim());
      const banner=document.querySelector(".banner");
      return {scroll:de.scrollWidth-de.clientWidth, over:[...new Set(over)].slice(0,3),
        wrapped, bannerH:banner?Math.round(banner.getBoundingClientRect().height):0};
    });
    if(m.scroll>1) bad.push(`${r} overflow ${m.scroll}px (${m.over.join(",")})`);
    if(m.over.length) bad.push(`${r} off-screen: ${m.over.join(",")}`);
    if(m.wrapped.length) bad.push(`${r} nav wrapped: ${m.wrapped.join(",")}`);
    await p.close();
  }
  ck(`${label} ${vw}x${vh}`, bad.length===0, bad.slice(0,2).join(" · "));
}
console.log(`\n${pass} passed, ${fail} failed`);
if(fails.length) console.log("FAILURES:\n - "+fails.join("\n - "));
await br.close();
