import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import fs from "node:fs";

const BASE = "http://localhost:3220";
const ROOM = "FILM";
const OUT = "frames";
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let n = 0;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(type, role, payload = {}, via = "tool") {
  const res = await fetch(`${BASE}/api/state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room: ROOM, type, role, via, payload }),
  });
  const d = await res.json();
  console.log(`  ${d.ok ? "ok " : "REFUSED "} ${type} — ${String(d.message).slice(0, 70)}`);
  return d;
}

const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=1"],
  headless: "shell",
  defaultViewport: { width: 1360, height: 900, deviceScaleFactor: 1 },
});

const page = await browser.newPage();

async function shot(label, hold = 1) {
  for (let i = 0; i < hold; i++) {
    const file = `${OUT}/${String(n).padStart(3, "0")}.png`;
    await page.screenshot({ path: file });
    n++;
  }
  console.log(`frame ${n} · ${label}`);
}

// Reset the room to a clean draft.
await api("reset", "lender", {}, "ui");

await page.goto(`${BASE}/?room=${ROOM}&role=lender`, { waitUntil: "networkidle2", timeout: 45000 });
await pause(2500);
await shot("workbench, drafting", 14);

// Get the agreement signed.
console.log("\nsigning:");
await api("propose-terms", "lender", { principal: 2400, installmentCount: 6, reminderBudget: 2, cureDays: 21 });
await pause(700);
await shot("terms proposed", 8);
await api("accept-terms", "borrower");
await api("sign-agreement", "lender");
await pause(700);
await shot("one half signed", 6);
await api("sign-agreement", "borrower");
await pause(600);
await shot("both halves signed — schedule live", 14);

// Move to overdue so the reminder capability appears.
console.log("\nclock:");
await api("advance-clock", "lender", { days: 34 }, "clock");
await pause(600);
await shot("overdue — send-reminder appears", 16);

// Spend the reminder budget.
console.log("\nreminders:");
await api("send-reminder", "lender", { message: "No rush, just flagging this one." });
await pause(650);
await shot("one reminder left", 12);
await api("send-reminder", "lender");
await pause(650);
await shot("budget spent — capability struck through", 22);

// The refusal.
console.log("\nforged call:");
await api("send-reminder", "lender");
await pause(1400);
await shot("third reminder refused", 12);

// Borrower asks for time; the answer registers on the lender.
console.log("\nobligation pair:");
await api("request-extension", "borrower", { extraDays: 14, reason: "Short this month — paid what I could." });
await pause(650);
await shot("grant/decline appear on the lender", 22);

// Default is unreachable.
console.log("\ndefault:");
await api("declare-default", "lender", { acknowledgement: "Marcus" });
await pause(1400);
await shot("default refused", 10);

await api("grant-extension", "lender");
await pause(650);
await shot("granted — answers unregister", 16);

// Dark theme.
console.log("\ntheme:");
await page.click('button[aria-label*="dark"]').catch(() => {});
await pause(1600);
await shot("dark theme", 18);

await browser.close();
console.log(`\ncaptured ${n} frames`);
