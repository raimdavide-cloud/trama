// Segnalazioni della Content-Security-Policy: una riga sintetica nei log, 204, dimensione limitata.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { route } from "../../api/router.mjs";
import { summarize } from "../../server/functions/csp-report.mjs";

const post = (body, headers = {}) =>
  route(new Request("http://localhost/api/csp-report", { method: "POST", headers: { "content-type": "application/csp-report", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));

function captureLog(fn) {
  const lines = [], orig = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  return Promise.resolve(fn()).finally(() => { console.log = orig; }).then((r) => ({ r, lines }));
}

const REPORT = {
  "csp-report": {
    "document-uri": "https://trama.example/studio?p=segreto",
    "effective-directive": "script-src-elem",
    "blocked-uri": "https://cattivo.example/x.js?token=123",
    "source-file": "https://trama.example/studio-app.js",
    "line-number": 42,
    disposition: "report",
  },
};

test("una segnalazione report-uri diventa una riga sintetica e la risposta è 204", async () => {
  const { r, lines } = await captureLog(() => post(REPORT));
  assert.equal(r.status, 204);
  assert.equal(lines.length, 1);
  assert.equal(lines[0], "csp report script-src-elem bloccato=https://cattivo.example/x.js pagina=https://trama.example/studio sorgente=https://trama.example/studio-app.js:42");
  assert.doesNotMatch(lines[0], /token|segreto/, "le query degli indirizzi non finiscono nei log");
});

test("accetta anche il formato della Reporting API (elenco di segnalazioni)", async () => {
  const body = [{ type: "csp-violation", body: { documentURL: "https://trama.example/", effectiveDirective: "style-src-elem", blockedURL: "inline", disposition: "report" } }, { type: "deprecation", body: {} }];
  const { r, lines } = await captureLog(() => post(body, { "content-type": "application/reports+json" }));
  assert.equal(r.status, 204);
  assert.deepEqual(lines, ["csp report style-src-elem bloccato=inline pagina=https://trama.example/"]);
});

test("corpi troppo grandi, non JSON o senza segnalazioni sono rifiutati senza scrivere nei log", async () => {
  const big = JSON.stringify({ "csp-report": { "document-uri": "x".repeat(9000) } });
  const { lines } = await captureLog(async () => {
    assert.equal((await post(big)).status, 413);
    assert.equal((await post("{}", { "content-length": "100000" })).status, 413);
    assert.equal((await post("non è json")).status, 400);
    assert.equal((await post({ altro: 1 })).status, 400);
  });
  assert.deepEqual(lines, []);
  assert.equal((await route(new Request("http://localhost/api/csp-report"))).status, 405);
});

test("i campi sono ripuliti: niente a capo e lunghezza limitata", () => {
  const line = summarize({ "effective-directive": "img-src\nfalso", "blocked-uri": "data", "document-uri": "https://t.example/" + "a".repeat(500) });
  assert.doesNotMatch(line, /\n/);
  assert.ok(line.length < 260, line);
});

test("vercel.json invia la politica a tutte le pagine, in sola segnalazione (il simulatore la legge da lì)", () => {
  const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url)));
  const all = vercel.headers.find((h) => h.source === "/(.*)").headers;
  const CSP = all.find((h) => h.key === "Content-Security-Policy-Report-Only")?.value;
  assert.ok(CSP, "intestazione assente in vercel.json");
  assert.ok(!all.some((h) => h.key === "Content-Security-Policy"), "la politica obbligatoria è una decisione separata");
  for (const d of ["default-src 'self'", "script-src 'self' https://cdnjs.cloudflare.com", "frame-ancestors 'none'", "report-uri /api/csp-report"]) assert.ok(CSP.includes(d), d);
  assert.doesNotMatch(CSP, /unsafe-eval|script-src[^;]*unsafe-inline/);
});
