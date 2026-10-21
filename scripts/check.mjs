// Controlli veloci prima di pubblicare (li esegue anche la CI): sintassi di tutto il JavaScript,
// nessuno script dentro le pagine HTML (CSP), JSON di configurazione, ponte scaricabile allineato, nessun segreto nei file versionati.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const errors = [];
const ok = (msg) => console.log(`  ok  ${msg}`);
const ko = (msg) => { errors.push(msg); console.log(`  NO  ${msg}`); };

function walk(dir, out = []) {
  let names = [];
  try { names = readdirSync(join(ROOT, dir)); } catch { return out; }
  for (const name of names) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

function syntax(file, label = file) {
  const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (r.status === 0) return true;
  ko(`sintassi: ${label}\n${r.stderr.split("\n").slice(0, 6).join("\n")}`);
  return false;
}

// 1. file JavaScript
const jsFiles = ["api", "server", "scripts", "tests", "public"].flatMap((d) => walk(d)).filter((f) => [".js", ".mjs"].includes(extname(f)));
const okJs = jsFiles.filter((f) => syntax(join(ROOT, f), f)).length;
if (okJs === jsFiles.length) ok(`sintassi di ${jsFiles.length} file JavaScript`);

// 2. niente JavaScript dentro le pagine HTML: la Content-Security-Policy (vercel.json) ammette solo file del sito e di cdnjs.
//    Restano permessi i blocchi di dati (JSON-LD), che il browser non esegue.
const inlineJs = [];
let dataBlocks = 0;
for (const f of walk("public").filter((f) => f.endsWith(".html"))) {
  const html = readFileSync(join(ROOT, f), "utf8");
  for (const [i, m] of [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)].entries()) {
    const attrs = m[1] || "";
    if (/\bsrc=/.test(attrs) || !m[2].trim()) continue;
    if (/application\/(ld\+)?json|importmap/.test(attrs)) {
      try { JSON.parse(m[2]); dataBlocks++; } catch (e) { ko(`JSON non valido: ${f} (script ${i + 1}): ${e.message}`); }
      continue;
    }
    inlineJs.push(`${f} (script ${i + 1})`);
  }
  for (const m of html.matchAll(/<[a-z][^>]*\s(on[a-z]+)=/gi)) inlineJs.push(`${f}: attributo ${m[1]}`);
  if (/href=["']?javascript:/i.test(html)) inlineJs.push(`${f}: collegamento javascript:`);
}
inlineJs.length ? ko(`JavaScript dentro le pagine (la CSP lo blocca: spostalo in un file .js):\n    ${inlineJs.join("\n    ")}`) : ok(`nessuno script nelle pagine HTML (${dataBlocks} blocchi di dati JSON-LD validi)`);

// 3. JSON di configurazione
for (const f of ["package.json", "vercel.json", "public/site.webmanifest"]) {
  try { JSON.parse(readFileSync(join(ROOT, f), "utf8")); ok(`JSON valido: ${f}`); }
  catch (e) { ko(e.code === "ENOENT" ? `file mancante: ${f}` : `JSON non valido: ${f} (${e.message})`); }
}

// 4. il ponte scaricabile dai colleghi deve essere identico al sorgente
const bridge = readFileSync(join(ROOT, "scripts/claude-bridge.mjs"), "utf8");
const packed = readFileSync(join(ROOT, "public/ponte/trama-ponte.mjs"), "utf8");
bridge === packed ? ok("ponte scaricabile allineato al sorgente") : ko("public/ponte/trama-ponte.mjs è vecchio: esegui npm run bridge:pack");

// 5. colori solo dai token: niente esadecimali nei fogli di stile, nei blocchi <style> e negli attributi style
//    (i loghi SVG con colori fissi del marchio sono esclusi: usano fill="#…", non gli stili)
const HEX = /#[0-9A-Fa-f]{3,8}\b/g;
const rawColors = [];
for (const f of walk("public").filter((f) => /\.(css|html)$/.test(f) && !f.endsWith("tokens.css"))) {
  const src = readFileSync(join(ROOT, f), "utf8");
  const styles = f.endsWith(".css") ? [src] : [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g), ...src.matchAll(/style="([^"]*)"/g)].map((m) => m[1]);
  const found = [...new Set(styles.join("\n").replace(/\/\*[\s\S]*?\*\//g, "").match(HEX) || [])];
  if (found.length) rawColors.push(`${f}: ${found.join(" ")}`);
}
rawColors.length ? ko(`colori scritti a mano fuori da tokens.css (usa i token):\n    ${rawColors.join("\n    ")}`) : ok("colori solo dai token");

// 5b. la parola «studio» non compare nei testi visibili: il prodotto e la sua interfaccia si chiamano Trama.
//     Si guardano i testi delle pagine e le stringhe del codice dell'interfaccia; restano fuori i percorsi e i nomi di file
//     (/studio, studio.css…) e le due pagine che elencano le parole da evitare (marchio e componenti).
const STUDIO = /(?<![\w\/.-])studio(?![\w-]|\.(?:css|js|html|mjs|png))/i;
const studioHits = [];
for (const f of walk("public").filter((f) => /\.(html|js)$/.test(f) && !/(brand|componenti)\.html$/.test(f) && !f.includes("/ponte/"))) {
  let src = readFileSync(join(ROOT, f), "utf8");
  if (f.endsWith(".html")) src = src.replace(/<(script|style|code)\b[\s\S]*?<\/\1>/g, " ").replace(/<[^>]*>/g, " ");
  else src = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const m = src.match(STUDIO);
  if (m) studioHits.push(`${f}: …${src.slice(Math.max(0, m.index - 25), m.index + 25).replace(/\s+/g, " ")}…`);
}
studioHits.length ? ko(`la parola «studio» nei testi visibili (si dice Trama):\n    ${studioHits.join("\n    ")}`) : ok("nessuna parola «studio» nei testi visibili");

// 6. nessun segreto nei file versionati
const SECRET = /sk-ant-[\w-]{20,}|ATATT[\w-]{20,}|\bATOA[\w-]{40,}|\bghp_[A-Za-z0-9]{36}|\bgithub_pat_\w{40,}|\bvercel_[\w-]{20,}|postgres(?:ql)?:\/\/(?!utente:password@host|user:password@host)[^\s"'`]+:[^\s"'`@]+@|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
let tracked = null;
try { tracked = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean); }
catch (e) { ko(`controllo segreti impossibile: git ls-files non riuscito (${e.message.split("\n")[0]})`); }
if (tracked && !tracked.length) ko("controllo segreti impossibile: git ls-files non ha restituito file");
else if (tracked) {
  const leaks = tracked.filter((f) => /\.(m?js|json|html|md|toml|ya?ml|txt|example)$/.test(f) && SECRET.test(readFileSync(join(ROOT, f), "utf8")));
  leaks.length ? ko(`possibili segreti in: ${leaks.join(", ")}`) : ok(`nessun segreto in ${tracked.length} file versionati`);
}

if (errors.length) { console.log(`\n${errors.length} controlli non superati.`); process.exit(1); }
console.log("\nTutti i controlli superati.");
