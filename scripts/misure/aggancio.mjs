// Misura dell'aggancio morbido della homepage con uno scorrimento «da trackpad»: tanti piccoli colpi di rotella che rallentano
// (come l'inerzia del Mac). Registra la posizione a ogni fotogramma e riporta: inversioni di direzione (scatti avanti-indietro),
// tempo per fermarsi, distanza finale dall'inizio della sezione più vicina, se l'aggancio è partito prima della fine dell'inerzia.
// Uso: node scripts/misure/aggancio.mjs [indirizzo]   (senza indirizzo avvia il simulatore sulla porta 8893)
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

let base = process.argv[2], sim;
if (!base) {
  base = "http://127.0.0.1:8893";
  sim = spawn(process.execPath, ["tests/sim/server.mjs"], { env: { ...process.env, PORT: "8893" }, stdio: "ignore" });
  for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/me"); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
}
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base + "/");
await page.mouse.move(700, 450);
const start = (id) => page.evaluate((id) => Math.round(document.getElementById(id).getBoundingClientRect().top + scrollY) - 62, id);

// inerzia: colpi ogni 16 ms che decadono; total ≈ somma dei colpi
async function trackpad(total, dir = 1) {
  const n = 45, k = 0.9, first = total * (1 - k) / (1 - k ** n);
  await page.evaluate(() => { window.__rec = []; window.__wheel = []; const t0 = (window.__t0 = performance.now()); window.__wl ||= addEventListener("wheel", () => window.__wheel.push(performance.now() - window.__t0), { passive: true }) || 1;
    const f = () => { window.__rec.push([performance.now() - t0, scrollY]); if (performance.now() - t0 < 4000) requestAnimationFrame(f); }; requestAnimationFrame(f); });
  for (let i = 0; i < n; i++) { await page.mouse.wheel(0, dir * first * k ** i); await page.waitForTimeout(16); }
  await page.waitForTimeout(2200);
  return page.evaluate(() => ({ rec: window.__rec, endInput: window.__wheel.at(-1) }));
}
// a ogni fotogramma: inversioni di direzione, movimenti più grandi di quelli dell'inerzia (= aggancio) e quando avvengono
function stats(rec, target, endInput) {
  let rev = 0, last = 0, settled = 0, snapStart = null, maxStep = 0, maxGap = 0;
  for (let i = 1; i < rec.length; i++) if (rec[i][0] < 2500) maxGap = Math.max(maxGap, rec[i][0] - rec[i - 1][0]);
  for (let i = 1; i < rec.length; i++) {
    const d = rec[i][1] - rec[i - 1][1];
    if (d !== 0) { if (last && Math.sign(d) !== Math.sign(last)) rev++; last = d; settled = rec[i][0]; maxStep = Math.max(maxStep, Math.abs(d)); }
  }
  // l'aggancio è l'ultimo tratto di movimento dopo una pausa o un cambio di passo: cerco il primo movimento dopo l'ultimo colpo
  for (let i = 1; i < rec.length; i++) if (rec[i][0] > endInput && rec[i][1] !== rec[i - 1][1]) { snapStart = rec[i][0]; break; }
  const y = rec.at(-1)[1];
  return { inversioni: rev, fotogramma_piu_lungo_ms: Math.round(maxGap), attesa_dopo_ultimo_colpo_ms: snapStart == null ? null : Math.round(snapStart - endInput), durata_aggancio_ms: snapStart == null ? 0 : Math.round(settled - snapStart), fermo_ms_dopo_ultimo_colpo: Math.round(settled - endInput), posizione_finale: Math.round(y), distanza_da_inizio_sezione: target == null ? null : Math.round(y - target) };
}
const out = {};
const scen = [
  ["fermo poco prima di «Vantaggi»", "vantaggi", 100, 1],
  ["fermo poco dopo l'inizio di «Regole» (scendendo)", "regole", -80, 1],
  ["a metà di «Regole»", "regole", -400, 1],
  ["risalendo, poco sotto l'inizio di «Esempi»", "esempi", -90, -1],
  ["scendendo, 150 px prima di «Esempi»", "esempi", 150, 1],
  ["scendendo, 220 px prima di «Esempi» (troppo lontano)", "esempi", 220, 1],
];
for (const [name, id, before, dir] of scen) {
  const t = await start(id);
  const stop = t - before; // dove si fermerebbe lo scorrimento senza aggancio
  const travel = 700;
  await page.evaluate((y) => scrollTo({ top: y, behavior: "instant" }), stop - dir * travel);
  await page.waitForTimeout(400);
  const r = await trackpad(travel, dir);
  const naturale = Math.round(r.rec.at(-1)[1]);
  out[name] = { inizio_sezione: t, ...stats(r.rec, t, r.endInput) };
}
console.log(JSON.stringify(out, null, 1));
await browser.close(); sim?.kill();
