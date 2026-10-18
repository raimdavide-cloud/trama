// Raccoglie i testi della homepage di Trama che non hanno ancora una traduzione inglese (public/i18n-home-en.js).
// Apre la homepage in inglese, passa da tutte le demo e da tutti gli esempi, poi stampa i testi mancanti.
// Uso: npm run i18n:mancanti-home   (avvia da solo un simulatore sulla porta 8894; serve Chrome installato)
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import { homeMissing } from "./home.mjs";

const PORT = 8894, base = `http://127.0.0.1:${PORT}`;
const sim = spawn(process.execPath, ["tests/sim/server.mjs"], { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/me"); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }

const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
await ctx.addInitScript(() => { try { localStorage.setItem("trama:lang", "en"); } catch {} });
const page = await ctx.newPage();
const missing = await homeMissing(page, base);
await browser.close(); sim.kill();
console.log(JSON.stringify(missing, null, 1));
console.error(`${missing.length} testi della homepage senza traduzione`);

