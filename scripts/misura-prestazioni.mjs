// Misure di prestazione di Trama sul simulatore: peso dell'apertura, tempi di ridisegno, modifiche, richieste di rete.
// Uso: npm run perf  (avvia da solo un simulatore sulla porta 8896; serve Chrome installato)
//      npm run perf -- --idle   aggiunge 3 minuti da fermo per misurare la sincronizzazione
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import { brotliCompressSync, gzipSync } from "node:zlib";

const PORT = 8896, base = `http://127.0.0.1:${PORT}`, IDLE = process.argv.includes("--idle");
const sim = spawn(process.execPath, ["tests/sim/server.mjs"], { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/me"); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
const browser = await chromium.launch({ channel: "chrome" });
const ms = (x) => Math.round(x);
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function open(page, mult = 1) {
  await fetch(base + "/__sim/reset");
  await page.goto(base + "/studio?p=progetto-prova");
  await page.locator(".progress b").waitFor();
  await page.waitForFunction(() => DATA_READY);
  if (mult > 1) await page.evaluate((mult) => { const ts = arr("tickets"); let n = 900; const add = {}; for (let k = 1; k < mult; k++) for (const t of ts) { const { id, ...d } = t; add["x" + k + id] = { ...d, ref: "T-" + n++ }; } S.tickets = { ...S.tickets, ...add }; }, mult);
}
const renderOf = (page, id) => page.evaluate(async (id) => {
  cur = STEPS.findIndex((x) => x.id === id);
  if (id === "create" && !T.pre) { A.go({ dataset: { i: cur } }); for (let i = 0; i < 300 && !T.pre; i++) await new Promise((r) => setTimeout(r, 100)); }
  const t = []; for (let i = 0; i < 5; i++) { const a = performance.now(); render(); t.push(performance.now() - a); }
  return t.sort((a, b) => a - b)[2];
}, id);

const out = { "Peso dell'apertura del progetto di prova": {}, "Ridisegno di un passo (ms, mediana di 5)": {}, "Modifica di un ticket nel Backlog": {}, "Salvataggi in blocco": {} };
// Peso dell'apertura: quanto scarica Trama dalle API dei dati per aprire il progetto di prova completo (con log e controllo
// di qualità), fino a dati pronti; poi lo stesso progetto con 5 documenti in più da 100.000 caratteri.
// In produzione Vercel comprime il JSON: conta la colonna «brotli».
{
  // testo finto ma realistico da comprimere: parole del documento di prova in ordine pseudo-casuale (sempre lo stesso)
  const words = (await (await fetch(base + "/__sim/reset?completo=1").then(() => fetch(base + "/api/projects/progetto-prova/items/docs/mvavnlehgrkql"))).json()).item.data.text.split(/\s+/).filter(Boolean);
  let seed = 7;
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const longText = () => { let t = ""; while (t.length < 100_000) t += words[Math.floor(rnd() * words.length)] + (rnd() < 0.08 ? "\n" : " "); return t.slice(0, 100_000); };
  const kb = (n) => Math.round(n / 102.4) / 10;
  async function weigh(label, extraDocs) {
    await fetch(base + "/__sim/reset?completo=1");
    for (let i = 1; i <= extraDocs; i++) {
      await fetch(`${base}/api/projects/progetto-prova/items/docs/lungo${i}`, { method: "PUT", body: JSON.stringify({ name: `Allegato ${i}.pdf`, kind: "PDF", text: longText(), chars: 100_000, truncated: false, at: i }) });
    }
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const bodies = [];
    p.on("response", (r) => { if (/^\/api\/projects\/progetto-prova(\/items\/.*)?$/.test(new URL(r.url()).pathname)) bodies.push(r.body()); });
    const t0 = Date.now();
    await p.goto(base + "/studio?p=progetto-prova");
    await p.locator(".progress b").waitFor();
    await p.waitForFunction(() => DATA_READY);
    const tReady = Date.now() - t0;
    await p.waitForTimeout(500);
    const all = await Promise.all(bodies);
    const sum = (f) => all.reduce((a, b) => a + f(b), 0);
    out["Peso dell'apertura del progetto di prova"][label] = { richieste: all.length, KB: kb(sum((b) => b.length)), "KB brotli": kb(sum((b) => brotliCompressSync(b).length)), "KB gzip": kb(sum((b) => gzipSync(b).length)), "ms a dati pronti": tReady };
    await p.close();
  }
  await weigh("Progetto di prova", 0);
  await weigh("Con 5 documenti da 100.000 caratteri", 5);
}
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
for (const mult of [1, 2, 4]) {
  await open(page, mult);
  const n = await page.evaluate(() => ticketList().length), row = {};
  for (const id of ["jira", "reqs", "backlog", "create"]) row[id] = ms(await renderOf(page, id));
  out["Ridisegno di un passo (ms, mediana di 5)"][`${n} ticket`] = row;
}
// una modifica salvata nel pannello di un ticket, a CPU normale e rallentata 4 volte
for (const rate of [1, 4]) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const cdp = await p.context().newCDPSession(p); await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  await open(p); await p.evaluate(() => A.go({ dataset: { i: STEPS.findIndex((x) => x.id === "backlog") } }));
  await p.locator('#main tr[data-k^="t-"]').first().click();
  const t = await p.evaluate(async () => { const id = T.panel.id; const a = performance.now(); put("tickets", id, { ...S.tickets[id], title: "Titolo cambiato" }); render(); return performance.now() - a; });
  out["Modifica di un ticket nel Backlog"][`CPU ${rate === 1 ? "normale" : "rallentata 4×"} (ms)`] = ms(t);
  await p.close();
}
// salvataggi in blocco: quante richieste partono e quanto ci mettono a finire (il simulatore risponde subito: in produzione ogni richiesta costa ~150 ms)
{
  const p = await browser.newPage(); let puts = 0, batches = 0;
  p.on("request", (r) => { if (r.method() === "PUT" && r.url().includes("/items/")) puts++; if (r.method() === "POST" && r.url().includes("/batch")) batches++; });
  await open(p);
  const tRen = await p.evaluate(async () => { const a = performance.now(); const el = { dataset: { bind: "meta:kit:releases.0.name" }, value: K().releases[0].name + " bis", type: "text" };
    document.dispatchEvent(Object.assign(new Event("change"), {})); const inp = document.createElement("input"); inp.dataset.bind = el.dataset.bind; inp.value = el.value; document.body.append(inp); inp.dispatchEvent(new Event("change", { bubbles: true })); inp.remove();
    await new Promise((r) => setTimeout(r, 50)); await wchain; return performance.now() - a; });
  out["Salvataggi in blocco"]["Rinomina della prima release"] = { "richieste": puts + batches, "ms in locale": ms(tRen) };
  puts = 0; batches = 0;
  const tAll = await p.evaluate(async () => { A.go({ dataset: { i: STEPS.findIndex((x) => x.id === "reqs") } }); A.relQuick(); const a = performance.now(); const b = document.querySelector("[data-act=relqAll]"); A.relqAll(b); A.relqAll(b); await new Promise((r) => setTimeout(r, 50)); await wchain; return performance.now() - a; });
  out["Salvataggi in blocco"]["Release a tutti i requisiti rimanenti"] = { "richieste": puts + batches, "ms in locale": ms(tAll) };
  await p.close();
}
if (IDLE) {
  const p = await browser.newPage(); const polls = [];
  p.on("request", (r) => { if (/\/api\/projects\/[^/]+\?since=/.test(r.url())) polls.push(Date.now()); });
  await open(p); const t0 = Date.now(); await p.waitForTimeout(180_000);
  const inMin = (a, b) => polls.filter((t) => t - t0 >= a * 60e3 && t - t0 < b * 60e3).length;
  out["Sincronizzazione da fermo (richieste)"] = { "1° minuto": inMin(0, 1), "2° minuto": inMin(1, 2), "3° minuto": inMin(2, 3) };
  await p.close();
}
await browser.close(); sim.kill();
for (const [k, v] of Object.entries(out)) { console.log(`\n${k}`); console.table(v); }
