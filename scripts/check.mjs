// Controlli veloci prima di pubblicare (li esegue anche la CI): sintassi di tutto il JavaScript,
// script dentro le pagine HTML, JSON di configurazione, ponte scaricabile allineato, nessun segreto nei file versionati.
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { tmpdir } from "node:os";
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

// 2. script dentro le pagine HTML (lo studio è quasi tutto qui)
const tmp = mkdtempSync(join(tmpdir(), "trama-check-"));
let inline = 0;
for (const f of walk("public").filter((f) => f.endsWith(".html"))) {
  const html = readFileSync(join(ROOT, f), "utf8");
  for (const [i, m] of [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)].entries()) {
    const attrs = m[1] || "";
    if (/\bsrc=/.test(attrs) || /application\/(ld\+)?json|importmap/.test(attrs) || !m[2].trim()) continue;
    const out = join(tmp, `${f.replace(/\W/g, "_")}_${i}${/type=["']?module/.test(attrs) ? ".mjs" : ".js"}`);
    writeFileSync(out, m[2]);
    if (syntax(out, `${f} (script ${i + 1})`)) inline++;
  }
}
rmSync(tmp, { recursive: true, force: true });
ok(`${inline} script nelle pagine HTML`);

// 3. JSON di configurazione
for (const f of ["package.json", "vercel.json", "public/manifest.webmanifest"]) {
  try { JSON.parse(readFileSync(join(ROOT, f), "utf8")); ok(`JSON valido: ${f}`); }
  catch (e) { if (e.code !== "ENOENT") ko(`JSON non valido: ${f} (${e.message})`); }
}

// 4. il ponte scaricabile dai colleghi deve essere identico al sorgente
const bridge = readFileSync(join(ROOT, "scripts/claude-bridge.mjs"), "utf8");
const packed = readFileSync(join(ROOT, "public/ponte/trama-ponte.mjs"), "utf8");
bridge === packed ? ok("ponte scaricabile allineato al sorgente") : ko("public/ponte/trama-ponte.mjs è vecchio: esegui npm run bridge:pack");

// 5. nessun segreto nei file versionati
const SECRET = /sk-ant-[\w-]{20,}|ATATT[\w-]{20,}|postgres(?:ql)?:\/\/(?!utente:password@host|user:password@host)[^\s"'`]+:[^\s"'`@]+@|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
let tracked = [];
try { tracked = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean); } catch {}
const leaks = tracked.filter((f) => /\.(m?js|json|html|md|toml|ya?ml|txt|example)$/.test(f) && SECRET.test(readFileSync(join(ROOT, f), "utf8")));
leaks.length ? ko(`possibili segreti in: ${leaks.join(", ")}`) : ok(`nessun segreto in ${tracked.length} file versionati`);

if (errors.length) { console.log(`\n${errors.length} controlli non superati.`); process.exit(1); }
console.log("\nTutti i controlli superati.");
