// Raccoglie i testi dell'interfaccia di Trama che non hanno ancora una traduzione inglese.
// Apre Trama in inglese sul simulatore, attraversa passi, sezioni, pannelli, menu, chat, progetto nuovo e creazione su Jira,
// poi stampa i testi mancanti (normalizzati con {n}, {q}, {k}) esclusi i dati del progetto di prova.
// Uso: npm run i18n:mancanti   (avvia da solo un simulatore sulla porta 8895; serve Chrome installato)
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { datiDiProva, isData, norm } from "./filtro.mjs";

const PORT = 8895, base = `http://127.0.0.1:${PORT}`;
const sim = spawn(process.execPath, ["tests/sim/server.mjs"], { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/me"); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }

const data = datiDiProva();

const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem("trama:lang", "en"); } catch {} });
const page = await ctx.newPage();
const all = new Set();
const harvest = async () => { for (const s of await page.evaluate(() => [...(window.I18N?.missing || [])])) all.add(s); };
const go = (id) => page.evaluate((id) => A.go({ dataset: { i: STEPS.findIndex((x) => x.id === id) } }), id);
const openAll = () => page.evaluate(async () => {
  for (const d of document.querySelectorAll("#main details")) { if (d.classList.contains("locked")) continue; d.open = true; await new Promise((r) => setTimeout(r, 30)); }
});
const settle = () => page.waitForTimeout(250);

await fetch(base + "/__sim/reset");
await page.goto(base + "/studio"); await page.locator(".proj-card").first().waitFor(); await harvest();
await page.locator(".proj-card .dd-btn").first().click().catch(() => {}); await harvest();
await page.goto(base + "/studio?p=progetto-prova"); await page.waitForFunction(() => window.DATA_READY === true || (typeof DATA_READY !== "undefined" && DATA_READY));
for (const id of ["jira", "reqs", "questions", "kit", "backlog", "create", "decisions"]) {
  await go(id); if (id === "create") await page.waitForFunction(() => !!T.pre, null, { timeout: 30000 });
  await settle();
  // ogni sezione dello stepper, una alla volta (sono esclusive), poi tutte le righe di secondo livello
  const n = await page.locator("#main details.sec").count();
  for (let i = 0; i < n; i++) { await page.evaluate((i) => { const d = document.querySelectorAll("#main details.sec")[i]; if (!d.classList.contains("locked")) d.open = true; }, i); await settle(); await openAll(); await harvest(); }
  await harvest();
}
// pannelli, assegnazione rapida, menu, chat, collegamenti, verifica, regole
await go("reqs"); await settle(); await page.locator('#main tr[data-k^="req-"]').first().click().catch(() => {}); await settle(); await harvest(); await page.keyboard.press("Escape");
await page.locator("[data-act=relQuick]").click().catch(() => {}); await settle(); await harvest(); await page.keyboard.press("Escape");
await go("backlog"); await settle(); await page.locator('#main tr[data-k^="t-"]').first().click().catch(() => {}); await settle(); await harvest(); await page.keyboard.press("Escape");
await page.evaluate(() => A.addTicket()); await settle(); await harvest(); await page.keyboard.press("Escape");
for (const sel of ["#projBtn", "#userBtn", "#langBtn"]) { await page.locator(sel).click().catch(() => {}); await settle(); await harvest(); await page.keyboard.press("Escape"); }
await page.locator("#capChips button").first().click().catch(() => {}); await settle(); await harvest();
await page.evaluate(() => A.healthCheck()); await page.waitForTimeout(2500); await harvest();
await page.locator("#rulesBtn").click(); await settle(); await harvest(); await page.locator("[data-act=closeRules]").click();
await page.locator("#chatFab").click(); await settle(); await harvest(); await page.keyboard.press("Escape");
// progetto nuovo: step bloccati e stati vuoti
await page.evaluate(() => { for (const c of ["docs", "reqs", "tickets", "questions", "decisions"]) for (const k of Object.keys(S[c])) del(c, k); editKit((k) => { k.releases = []; k.epics = []; }); });
for (const id of ["reqs", "questions", "kit", "backlog", "create", "decisions"]) { await go(id); await page.waitForTimeout(600); await openAll(); await harvest(); }
// creazione su Jira completa (log, esito, sincronizzazione)
await fetch(base + "/__sim/reset");
await page.reload(); await page.waitForFunction(() => typeof DATA_READY !== "undefined" && DATA_READY);
await go("create"); await page.waitForFunction(() => !!T.pre, null, { timeout: 30000 });
await page.evaluate(async () => { T.ack = true; render(); });
await page.evaluate(() => { const b = document.querySelector("[data-act=runCreate]"); A.runCreate(b); A.runCreate(b); });
await page.waitForFunction(() => /Verifica: \d+/.test(document.querySelector("#main")?.innerText || ""), null, { timeout: 150000 }).catch(() => {});
await openAll(); await harvest();
await page.evaluate(() => A.syncJira?.()); await page.waitForTimeout(3000); await openAll(); await harvest();

await browser.close(); sim.kill();
const ui = [...all].filter((s) => !isData(s, data)).sort((a, b) => a.localeCompare(b, "it"));
const keys = [...new Set(ui.map(norm))];
console.log(JSON.stringify(keys, null, 1));
console.error(`${keys.length} testi senza traduzione`);
