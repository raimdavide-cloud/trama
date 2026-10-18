// Versioni dei file statici (scripts/versioni.mjs, eseguito nella build di Vercel): ogni riferimento porta l'impronta giusta,
// chi cita un file cambiato cambia impronta a sua volta, e un secondo passaggio non cambia nulla.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { versiona } from "../../scripts/versioni.mjs";

const h = (f) => createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 10);

test("riferimenti in pagine, script e fogli di stile con l'impronta del contenuto; frammenti e link esterni intatti", () => {
  const d = mkdtempSync(join(tmpdir(), "versioni-"));
  mkdirSync(join(d, "fonts"));
  writeFileSync(join(d, "fonts", "a.woff2"), "font");
  writeFileSync(join(d, "fonts.css"), "@font-face{src:url(/fonts/a.woff2) format('woff2')}");
  writeFileSync(join(d, "icons.svg"), "<svg/>");
  writeFileSync(join(d, "app.js"), 'const I=n=>`<use href="/icons.svg#${n}"/>`;const x="/api/me";');
  writeFileSync(join(d, "index.html"), '<link rel="stylesheet" href="/fonts.css"><script src="/app.js"></script><script src="/i18n.js" data-dict="/dict.js"></script><a href="https://esempio.it/x.js">x</a><img src="/og.png">');
  writeFileSync(join(d, "i18n.js"), "1");
  writeFileSync(join(d, "dict.js"), "2");
  const r = versiona(d);
  const css = readFileSync(join(d, "fonts.css"), "utf8"), js = readFileSync(join(d, "app.js"), "utf8"), html = readFileSync(join(d, "index.html"), "utf8");
  assert.ok(css.includes(`/fonts/a.woff2?v=${h(join(d, "fonts", "a.woff2"))})`));
  assert.ok(js.includes(`/icons.svg?v=${h(join(d, "icons.svg"))}#\${n}`), js);
  assert.ok(js.includes('"/api/me"'));
  assert.ok(html.includes(`href="/fonts.css?v=${h(join(d, "fonts.css"))}"`), "il foglio di stile ha l'impronta del contenuto già aggiornato");
  assert.ok(html.includes(`src="/app.js?v=${h(join(d, "app.js"))}"`));
  assert.ok(html.includes(`data-dict="/dict.js?v=${h(join(d, "dict.js"))}"`));
  assert.ok(html.includes('href="https://esempio.it/x.js"') && html.includes('src="/og.png"'));
  assert.ok(r.passes >= 2);
  const before = readFileSync(join(d, "index.html"), "utf8");
  assert.equal(versiona(d).passes, 1, "idempotente");
  assert.equal(readFileSync(join(d, "index.html"), "utf8"), before);
  // un font cambiato cambia anche l'indirizzo del foglio di stile che lo cita
  writeFileSync(join(d, "fonts", "a.woff2"), "font nuovo");
  versiona(d);
  assert.notEqual(readFileSync(join(d, "index.html"), "utf8"), before);
  rmSync(d, { recursive: true });
});

test("la cartella public reale: nessun riferimento locale resta senza versione", () => {
  const d = mkdtempSync(join(tmpdir(), "versioni-pub-"));
  cpSync(new URL("../../public", import.meta.url), d, { recursive: true });
  versiona(d);
  for (const f of ["index.html", "studio.html", "brand.html", "architettura.html"]) {
    const s = readFileSync(join(d, f), "utf8");
    const plain = [...s.matchAll(/(?:src|href)="(\/[\w./-]+\.(?:js|css|woff2))"/g)].map((m) => m[1]);
    assert.deepEqual(plain, [], `${f}: ${plain.join(", ")}`);
  }
  assert.match(readFileSync(join(d, "studio-app.js"), "utf8"), /\/icons\.svg\?v=[0-9a-f]{10}#/);
  rmSync(d, { recursive: true });
});
