// Riepilogo in Markdown del rilevatore di design (Impeccable): legge il JSON di `impeccable detect --json` dallo standard input.
// Uso: npm run -s design -- --json | node scripts/design-riepilogo.mjs     (la CI lo scrive nel riepilogo del lavoro, senza bloccare)
import { relative } from "node:path";

let raw = "";
for await (const c of process.stdin) raw += c;
let found;
try { found = JSON.parse(raw || "[]"); } catch { console.log("Il rilevatore non ha prodotto un risultato leggibile."); process.exit(0); }

const root = process.cwd();
const by = new Map(), files = new Map();
for (const f of found) {
  const k = `${f.antipattern}|${f.severity}|${f.category}`;
  by.set(k, (by.get(k) || 0) + 1);
  const file = relative(root, f.file);
  files.set(file, (files.get(file) || 0) + 1);
}
const rows = [...by].sort((a, b) => b[1] - a[1]);
console.log("### Qualità del design (Impeccable)\n");
if (!found.length) { console.log("Nessuna segnalazione."); process.exit(0); }
console.log(`${found.length} segnalazioni. Questo passo **non blocca**: serve a vedere se aumentano.\n`);
console.log("| Regola | Gravità | Tipo | N |\n|---|---|---|---:|");
for (const [k, n] of rows) { const [a, s, c] = k.split("|"); console.log(`| ${a} | ${s} | ${c} | ${n} |`); }
console.log("\n| File | N |\n|---|---:|");
for (const [f, n] of [...files].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`| ${f} | ${n} |`);
