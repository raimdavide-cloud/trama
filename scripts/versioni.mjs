// Versioni dei file statici: ogni riferimento a .js, .css, .svg e .woff2 nelle pagine, negli script e nei fogli di stile
// diventa «/file.ext?v=<impronta del contenuto>». Con l'impronta nell'indirizzo i file restano in cache un anno
// (vercel.json › headers, solo per le richieste con ?v): un deploy che cambia un file ne cambia anche l'indirizzo.
// Gira nella build di Vercel (vercel.json › buildCommand) sulla copia del deploy: nel repository i riferimenti restano puliti.
// Uso: node scripts/versioni.mjs public
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ASSET = new Set([".js", ".css", ".svg", ".woff2"]);
const TEXT = new Set([".html", ".js", ".css"]);
// riferimento assoluto preceduto da virgolette, apice inverso, parentesi o «=», seguito da fine stringa, frammento o parentesi
const REF = /(["'`(=])(\/[\w./-]+?\.(?:js|css|svg|woff2))(?:\?v=[0-9a-f]{10})?(?=[#"'`)\s])/g;

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

export function versiona(dir) {
  const files = walk(dir);
  const url = (f) => "/" + relative(dir, f).split(sep).join("/");
  const assets = new Map(files.filter((f) => ASSET.has(extname(f))).map((f) => [url(f), f]));
  const texts = files.filter((f) => TEXT.has(extname(f)));
  const hash = (f) => createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 10);
  // si ripete finché nessun file cambia: chi cita un file cambiato cambia a sua volta impronta
  for (let pass = 1; pass <= 12; pass++) {
    const h = new Map([...assets].map(([u, f]) => [u, hash(f)]));
    let changed = 0;
    for (const f of texts) {
      const self = url(f), s = readFileSync(f, "utf8");
      const s2 = s.replace(REF, (m, pre, path) => (assets.has(path) && path !== self ? `${pre}${path}?v=${h.get(path)}` : m));
      if (s2 !== s) { writeFileSync(f, s2); changed++; }
    }
    if (!changed) return { passes: pass, versions: h };
  }
  throw new Error("Riferimenti circolari tra file statici: impossibile fissare le versioni.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] || "public";
  const { passes, versions } = versiona(dir);
  console.log(`Versioni fissate per ${versions.size} file statici in ${passes} passaggi.`);
}
