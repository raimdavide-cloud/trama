// Contrasto delle coppie di colori dei token, nel tema chiaro e in quello scuro (WCAG 2.2 AA).
// Legge solo public/tokens.css: risolve i var() e calcola il rapporto di luminanza. Esce con 1 se una coppia è sotto soglia.
// Uso: npm run design:contrasto
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../public/tokens.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const decls = (block) => Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)].map((m) => [m[1], m[2].trim()]));
const light = decls(css.match(/^:root\{([\s\S]*?)\n\}/m)[1]);
const dark = { ...light, ...decls(css.match(/:root\[data-theme="dark"\]\{([\s\S]*?)\}/)[1]) };

const resolve = (vars, v, depth = 0) => {
  const m = v.match(/^var\((--[\w-]+)\)$/);
  return m && depth < 8 ? resolve(vars, vars[m[1]], depth + 1) : v;
};
const rgb = (hex) => { const h = hex.replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const lum = ([r, g, b]) => [r, g, b].reduce((s, v, i) => { v /= 255; return s + (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]; }, 0);
const ratio = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [primo piano, sfondo, soglia, a cosa serve]
const PAIRS = [
  ["--fg", "--bg", 4.5, "testo su pagina"], ["--fg", "--surface", 4.5, "testo su superficie"], ["--fg", "--sunk", 4.5, "testo su fondo incassato"],
  ["--muted", "--bg", 4.5, "testo secondario su pagina"], ["--muted", "--surface", 4.5, "testo secondario su superficie"], ["--muted", "--sunk", 4.5, "testo secondario su incassato"],
  ["--primary", "--bg", 4.5, "link su pagina"], ["--primary", "--surface", 4.5, "link su superficie"], ["--primary", "--primary-soft", 4.5, "testo indaco su selezione"],
  ["--on-primary", "--primary", 4.5, "testo del pulsante principale"], ["--primary-strong", "--surface", 4.5, "testo indaco forte"],
  ["--accent-text", "--thread-soft", 4.5, "testo su zafferano chiaro"], ["--warn", "--warn-soft", 4.5, "etichetta avviso"],
  ["--ok", "--ok-soft", 4.5, "etichetta ok"], ["--err", "--err-soft", 4.5, "etichetta errore"],
  ["--ok", "--surface", 4.5, "testo ok su superficie"], ["--err", "--surface", 4.5, "testo errore su superficie"], ["--warn", "--surface", 4.5, "testo avviso su superficie"],
  ["--band-fg", "--band", 4.5, "testo sulla fascia scura"], ["--band-muted", "--band", 4.5, "testo secondario sulla fascia"],
  ["--tip-fg", "--tip-bg", 4.5, "suggerimento"], ["--disabled-fg", "--disabled-bg", 4.5, "controllo disattivato"],
  // elementi grafici e bordi dei controlli: 3:1 (WCAG 1.4.11)
  ["--line-strong", "--surface", 3, "bordo di campi e caselle su superficie"], ["--line-strong", "--bg", 3, "bordo di campi e caselle su pagina"],
  ["--primary", "--surface", 3, "anello di focus"], ["--thread", "--bg", 3, "filo su pagina"], ["--thread", "--surface", 3, "filo su superficie"],
  ["--ok", "--surface", 3, "spia ok"], ["--err", "--surface", 3, "spia errore"], ["--warn", "--surface", 3, "spia avviso"],
];

let bad = 0;
for (const [name, vars] of [["chiaro", light], ["scuro", dark]]) {
  console.log(`\nTema ${name}`);
  for (const [fg, bg, min, what] of PAIRS) {
    const r = ratio(resolve(vars, vars[fg]), resolve(vars, vars[bg]));
    const ok = r >= min;
    if (!ok) bad++;
    console.log(`  ${ok ? "ok" : "NO"}  ${r.toFixed(2).padStart(5)}  (≥ ${min})  ${what}  [${fg} su ${bg}]`);
  }
}
console.log(bad ? `\n${bad} coppie sotto soglia.` : "\nTutte le coppie rispettano le soglie.");
process.exit(bad ? 1 : 0);
