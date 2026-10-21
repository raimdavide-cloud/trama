// Scheda QA: contenuto costruito dai dati del progetto di prova (la allega a ogni storia Trama su Jira).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const W = {};
new Function("window", readFileSync(new URL("../../public/qa-scheda.js", import.meta.url), "utf8"))(W);
const { QA } = W;

const fx = JSON.parse(readFileSync(new URL("../fixtures/progetto-prova.json", import.meta.url), "utf8"));
const col = (c) => fx.items.filter((i) => i.col === c).map((i) => ({ ...i.data, id: i.id }));
const ctx = { tickets: col("tickets"), reqs: col("reqs"), decisions: col("decisions"), siteUrl: "https://esempio.atlassian.net", project: "Prova", today: "2026-10-18" };
const T002 = ctx.tickets.find((t) => t.ref === "T-002");

test("scheda: criteri come checklist, requisito d'origine, dipendenze nei due versi, ipotesi e punti da chiarire", () => {
  const s = QA.sheet(T002, ctx);
  assert.match(s.md, /^---\nticket: ORTO-896\nref: T-002\n/);
  assert.match(s.md, /jira: "https:\/\/esempio\.atlassian\.net\/browse\/ORTO-896"/);
  assert.match(s.md, /## Cosa verificare\n- \[ \] AC1 · A new user can register/);
  assert.match(s.md, /\*\*RF-001 · Registrazione con email e password\*\* \(fonte: requisiti-ortocomune\.md\)/);
  assert.match(s.md, /- Sblocca: T-004/);
  assert.match(s.md, /- Collegato a: T-001/);
  assert.match(s.md, /## Ipotesi da confermare\n- ⚠️ /);
  assert.match(s.md, /## Punti da chiarire\n- Password policy/);
  assert.ok(!s.md.includes("## Acceptance criteria"), "le sezioni già usate non si ripetono");
  assert.equal(s.ready, false);
  assert.deepEqual(s.gaps, ["5 ipotesi da confermare", "5 punti da chiarire"]);
  assert.equal(s.name, "ORTO-896-email-password-registration-and-email-verification-api.md");
  // chi è sbloccato da T-002 lo vede come «da collaudare dopo»
  assert.match(QA.sheet(ctx.tickets.find((t) => t.ref === "T-004"), ctx).md, /- Da collaudare dopo: T-002 \(ORTO-896\)/);
});

test("scheda: le righe segnaposto del modello non contano come criteri e un ticket completo è pronto", () => {
  const vuoto = { ref: "T-900", type: "Story", req: "", desc: "## Acceptance criteria\n* Verifiable outcomes, one per bullet.", links: [] };
  const s = QA.sheet(vuoto, ctx);
  assert.match(s.md, /Nessun criterio di accettazione nel ticket/);
  assert.ok(s.gaps.includes("Mancano i criteri di accettazione"));
  const ok = { ref: "T-901", key: "ORTO-1", type: "Story", req: "RF-001", desc: "## Acceptance criteria\n* Works.", links: [] };
  const r = QA.sheet(ok, ctx);
  assert.equal(r.ready, true);
  assert.match(r.md, /pronta_per_qa: true/);
  assert.match(r.md, /✅ Nessun punto aperto/);
});

test("scheda: le decisioni sostituite non compaiono, quelle che citano il ticket sì", () => {
  const t = { ref: "T-950", key: "ORTO-950", type: "Story", req: "RF-999", desc: "## Acceptance criteria\n* x", links: [] };
  const decisions = [
    { id: "a", date: "2026-10-01", text: "RF-999: login con email", who: "PO" },
    { id: "b", date: "2026-10-02", text: "RF-999: login con email e Google", replaces: "a", source: "Call" },
    { id: "c", date: "2026-10-03", text: "RF-9990 non c'entra" },
  ];
  const md = QA.sheet(t, { ...ctx, decisions }).md;
  assert.match(md, /- 2026-10-02 · RF-999: login con email e Google · Fonte: Call/);
  assert.ok(!md.includes("login con email ·"));
  assert.ok(!md.includes("RF-9990"));
});

test("titoli tradotti con ctx.tr, contenuti lasciati come sono", () => {
  const tr = (s) => ({ "Cosa verificare": "What to verify", "Da dove nasce": "Where it comes from" })[s] || s;
  const md = QA.sheet(T002, { ...ctx, tr }).md;
  assert.match(md, /## What to verify/);
  assert.match(md, /## Where it comes from\n\*\*RF-001 · Registrazione/);
});

test("scheda: un codice requisito con metacaratteri delle espressioni regolari non rompe la ricerca delle decisioni", () => {
  const t = { ref: "T-950", type: "Story", req: "RF+(1[", desc: "## Acceptance criteria\n* Works.", links: [] };
  const decisions = [
    { id: "d1", date: "2026-10-18", text: "RF+(1[ resta in MVP", who: "PO" },
    { id: "d2", date: "2026-10-18", text: "RFF(1[ è un altro requisito", who: "PO" },
  ];
  const s = QA.sheet(t, { ...ctx, decisions });
  assert.match(s.md, /RF\+\(1\[ resta in MVP/);
  assert.ok(!s.md.includes("RFF(1[ è un altro requisito"));
});
