// Apertura leggera: testo dei documenti, log della creazione e controllo di qualità arrivano come segnaposto
// e si caricano solo quando servono. Un salvataggio non sovrascrive mai il contenuto completo con il segnaposto.
import { test, expect } from "@playwright/test";
import { openStudio, goToStep, openSec } from "./aiuti.mjs";

const DOC = "mvavnlehgrkql"; // requisiti-ortocomune.md nel progetto di prova
const ITEM = (col, id) => `/api/projects/progetto-prova/items/${col}/${id}`;
const fullOf = async (request, col, id) => (await (await request.get(ITEM(col, id))).json()).item.data;

// richieste di contenuti completi fatte dalla pagina
function itemLoads(page) {
  const list = [];
  page.on("request", (r) => { if (r.method() === "GET" && /\/api\/projects\/[^/]+\/items\//.test(r.url())) list.push(new URL(r.url()).pathname.split("/items/")[1]); });
  return list;
}

// Claude finto al posto del ponte locale: registra le richieste e risponde con `reply` in streaming
async function fakeClaude(page, reply) {
  const asked = [];
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, OPTIONS" };
  await page.route("http://127.0.0.1:8790/health", (r) => r.fulfill({ headers: cors, json: { ok: true, loggedIn: true } }));
  await page.route("http://127.0.0.1:8790/ai", async (r) => {
    if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: cors });
    asked.push(r.request().postDataJSON());
    const events = [
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: JSON.stringify(reply) } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
    ];
    await r.fulfill({ headers: { ...cors, "content-type": "text/event-stream" }, body: events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") });
  });
  return asked;
}

test("apertura leggera: lo stato arriva senza testo dei documenti, log e segnalazioni, e nulla si carica finché non serve", async ({ page, request }) => {
  await request.get("/__sim/reset?completo=1");
  const loads = itemLoads(page);
  const opened = page.waitForResponse((r) => /\/api\/projects\/progetto-prova$/.test(new URL(r.url()).pathname));
  await openStudio(page);
  const body = await (await opened).json();
  const by = Object.fromEntries(body.items.map((i) => [`${i.col}/${i.id}`, i.data]));
  expect(by[`docs/${DOC}`].text).toBeUndefined();
  expect(by[`docs/${DOC}`]._lazy.len).toBeGreaterThan(10_000);
  expect(by["meta/runlog"].lines).toBeUndefined();
  expect(by["meta/runlog"].n).toBe(88);
  expect(by["meta/quality"].findings).toBeUndefined();
  expect(by["meta/quality"].sum).toEqual({ n: 53, open: 51, high: expect.any(Number) });
  expect(JSON.stringify(body)).not.toContain("OrtoComune — Documento dei Requisiti");
  // i conteggi si vedono senza caricare nulla: documenti nel riepilogo, segnalazioni sulla scheda Qualità
  await goToStep(page, "Backlog");
  await expect(page.locator("#tab-quality")).toContainText("51 da vedere");
  await goToStep(page, "Requisiti");
  await expect(page.locator("#main .docPick")).toHaveCount(1);
  expect(loads).toEqual([]);
});

test("aprire un documento ne carica il testo, una volta sola; dopo il ricaricamento torna leggero", async ({ page, request }) => {
  await request.get("/__sim/reset");
  const loads = itemLoads(page);
  await openStudio(page);
  await goToStep(page, "Requisiti");
  const doc = page.locator(`#main details[data-k="doc-${DOC}"]`);
  if (!(await doc.isVisible())) await openSec(page, "Documenti");
  await doc.locator("summary").click();
  await expect(doc.locator("pre.prev")).toContainText("OrtoComune — Documento dei Requisiti");
  expect(loads).toEqual([`docs/${DOC}`]);
  await doc.locator("summary").click();
  await doc.locator("summary").click();
  await expect(doc.locator("pre.prev")).toBeVisible();
  expect(loads).toHaveLength(1);
  // il documento resta aperto dopo il ricaricamento: si apre leggero e il testo arriva da solo
  await page.reload();
  await expect(page.locator(".progress b")).toContainText("di 6 passi completati");
  await expect(page.locator(`#main details[data-k="doc-${DOC}"] pre.prev`)).toContainText("OrtoComune");
  expect(loads).toHaveLength(2);
});

test("l'estrazione dei requisiti con Claude manda il testo completo del documento", async ({ page, request }) => {
  await request.get("/__sim/reset");
  const text = (await fullOf(request, "docs", DOC)).text;
  const asked = await fakeClaude(page, { requirements: [{ title: "Requisito estratto dal testo completo", desc: "prova", components: ["Web App"], release: "MVP" }] });
  await openStudio(page);
  await goToStep(page, "Requisiti");
  await page.waitForFunction(() => !!SAMPLE); // il ponte finto risponde
  expect(await page.evaluate((id) => !!S.docs[id]._lazy, DOC)).toBe(true);
  const btn = page.locator("[data-act=extractReqs]");
  if (!(await btn.isVisible())) await openSec(page, "Estrazione dei requisiti");
  await btn.click();
  await expect.poll(() => page.evaluate(() => reqList().some((r) => r.title === "Requisito estratto dal testo completo"))).toBe(true);
  const prompt = asked[0].messages.at(-1).content;
  expect(prompt).toContain(text.slice(0, 300));
  expect(prompt).toContain(text.slice(-300));
});

test("log della creazione e controllo di qualità si caricano quando si guardano", async ({ page, request }) => {
  await request.get("/__sim/reset?completo=1");
  const loads = itemLoads(page);
  await openStudio(page);
  await goToStep(page, "Backlog");
  await page.locator("#tab-quality").click();
  await expect(page.locator("#panel-quality .list .card").first()).toBeVisible();
  expect(loads).toEqual(["meta/quality"]);
  // ignorare una segnalazione salva il controllo intero, non il segnaposto
  const first = await page.evaluate(() => S.quality.findings.find((x) => x.status === "open").id);
  await page.locator(`#panel-quality [data-act=qIgnore][data-id="${first}"]`).click();
  await page.evaluate(() => BS.writesDone());
  const q = await fullOf(request, "meta", "quality");
  expect(q.findings).toHaveLength(53);
  expect(q.findings.find((x) => x.id === first).status).toBe("ignored");
  await goToStep(page, "Crea su Jira");
  await expect(page.locator("#main .log")).toContainText("Inizio creazione.");
  expect(loads).toEqual(["meta/quality", "meta/runlog"]);
});

test("nessuna sovrascrittura: un segnaposto non parte dal browser e il server lo rifiuta", async ({ page, request }) => {
  await request.get("/__sim/reset?completo=1");
  const before = await fullOf(request, "docs", DOC);
  await openStudio(page);
  const fromPage = await page.evaluate(async (id) => {
    const out = [];
    for (const [c, k, d] of [["docs", id, S.docs[id]], ["meta", "quality", S.quality], ["meta", "runlog", S.runlog]]) {
      try { await DB.doc(`${c}/${k}`).set(d); out.push("salvato"); } catch (e) { out.push(e.code); }
    }
    return out;
  }, DOC);
  expect(fromPage).toEqual(["placeholder", "placeholder", "placeholder"]);
  const ph = await page.evaluate((id) => S.docs[id], DOC);
  expect((await request.put(ITEM("docs", DOC), { data: ph })).status()).toBe(409);
  expect((await request.post("/api/projects/progetto-prova/batch", { data: { ops: [{ col: "docs", id: DOC, data: ph }] } })).status()).toBe(409);
  expect(await fullOf(request, "docs", DOC)).toEqual(before);
  expect((await fullOf(request, "meta", "quality")).findings).toHaveLength(53);
  expect((await fullOf(request, "meta", "runlog")).lines).toHaveLength(88);
});

test("sincronizzazione: il proprio salvataggio resta intero, la modifica di un collega torna segnaposto e si ricarica", async ({ page, request }) => {
  await request.get("/__sim/reset");
  await openStudio(page);
  await page.evaluate(() => put("docs", "nuovo", { name: "Verbale", kind: "Testo", text: "Testo àccentato — «virgolette» ".repeat(50), chars: 1550, truncated: false, at: 1 }));
  await page.evaluate(() => BS.writesDone());
  await page.evaluate(() => DB.poll());
  // l'eco del proprio salvataggio ha la stessa impronta calcolata dal server: il testo resta in memoria
  expect(await page.evaluate(() => S.docs.nuovo.text?.length)).toBe(1550);
  // un collega cambia il documento: arriva il segnaposto della nuova versione, il testo nuovo si carica quando serve
  await request.put(ITEM("docs", "nuovo"), { data: { name: "Verbale", kind: "Testo", text: "Versione del collega", chars: 20, truncated: false, at: 2 } });
  await page.evaluate(() => DB.poll());
  expect(await page.evaluate(() => !!S.docs.nuovo._lazy)).toBe(true);
  expect(await page.evaluate(async () => (await full("docs", "nuovo")).text)).toBe("Versione del collega");
});
