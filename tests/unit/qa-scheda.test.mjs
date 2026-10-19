// Scheda QA e piano di test: contenuto costruito dai dati del progetto di prova, ordine di collaudo, zip leggibile.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

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

test("ordine di collaudo: chi blocca viene prima, anche con un ciclo si arriva in fondo", () => {
  const ts = [{ ref: "B", links: [] }, { ref: "A", links: [{ type: "blocks", to: "B" }] }, { ref: "C", links: [{ type: "is blocked by", to: "B" }] }];
  assert.deepEqual(QA.testOrder(ts).map((x) => x.t.ref), ["A", "B", "C"]);
  assert.deepEqual(QA.testOrder(ts)[1].after, ["A"]);
  const ciclo = [{ ref: "X", links: [{ type: "blocks", to: "Y" }] }, { ref: "Y", links: [{ type: "blocks", to: "X" }] }];
  assert.equal(QA.testOrder(ciclo).length, 2);
});

test("piano di test della release: sintesi, perimetro, fuori perimetro, requisiti scoperti e campi per il QA", () => {
  const p = QA.plan("MVP (pilota)", ctx);
  assert.equal(p.tickets.length, 31);
  assert.equal(p.out, 36);
  assert.match(p.md, /# Piano di test · MVP \(pilota\)/);
  assert.match(p.md, /- Ticket da collaudare: 31 /);
  assert.match(p.md, /- Fuori perimetro \(Spike e UX Story\): 36/);
  assert.match(p.md, /\| T-002 \| ORTO-896 \| Story \|/);
  assert.match(p.md, /## Requisiti non funzionali da verificare\n- RNF-/);
  assert.match(p.md, /## Da compilare a cura del QA\n- Ambienti: \n- Dati di test: /);
  const order = p.md.split("## Ordine consigliato")[1];
  assert.ok(order.indexOf("T-002 ") < order.indexOf("T-004 "), "T-002 sblocca T-004");
});

test("zip: un piano e una scheda per ticket, file leggibili con CRC corretti e nomi UTF-8", () => {
  const b = QA.bundle(["MVP (pilota)"], ctx);
  assert.equal(b.sheets, 31);
  assert.equal(b.files[0].name, "piano-di-test.md");
  assert.ok(b.files.slice(1).every((f) => f.name.startsWith("schede/") && f.name.endsWith(".md")));
  const z = Buffer.from(QA.zip([...b.files, { name: "à-è.md", text: "perché" }]));
  // lettura con la directory centrale, come fanno gli strumenti di sistema
  const eocd = z.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const n = z.readUInt16LE(eocd + 10);
  let p = z.readUInt32LE(eocd + 16);
  const got = [];
  for (let i = 0; i < n; i++) {
    assert.equal(z.readUInt32LE(p), 0x02014b50);
    assert.equal(z.readUInt16LE(p + 8) & 0x0800, 0x0800);
    const crc = z.readUInt32LE(p + 16), size = z.readUInt32LE(p + 20), nl = z.readUInt16LE(p + 28), off = z.readUInt32LE(p + 42);
    const name = z.subarray(p + 46, p + 46 + nl).toString("utf8");
    const lnl = z.readUInt16LE(off + 26), data = z.subarray(off + 30 + lnl, off + 30 + lnl + size);
    assert.equal(QA.crc32(data), crc);
    got.push([name, data.toString("utf8")]);
    p += 46 + nl;
  }
  assert.equal(got.length, b.files.length + 1);
  assert.deepEqual(got.at(-1), ["à-è.md", "perché"]);
  assert.equal(got[0][1], b.files[0].text);
  assert.equal(typeof inflateRawSync, "function"); // metodo STORE: nessuna decompressione necessaria
});

test("più release: una cartella per release e i ticket senza release a parte", () => {
  const ts = [{ ref: "T-1", type: "Story", release: "R1", desc: "", links: [] }, { ref: "T-2", type: "Story", release: "", desc: "", links: [] }];
  const b = QA.bundle(["R1", null], { ...ctx, tickets: ts, reqs: [] });
  assert.deepEqual(b.files.map((f) => f.name), ["r1/piano-di-test.md", "r1/schede/T-1-senza-nome.md", "senza-release/piano-di-test.md", "senza-release/schede/T-2-senza-nome.md"]);
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
