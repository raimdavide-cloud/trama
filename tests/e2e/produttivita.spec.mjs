// Lavoro di tutti i giorni nel Backlog e nel kit: ricerca e modifica in blocco dei ticket, «Annulla» dopo le eliminazioni,
// kit da un modello o da un altro progetto, controllo qualità automatico sui ticket cambiati.
import { test, expect } from "@playwright/test";
import { openStudio, goToStep } from "./aiuti.mjs";

test.beforeEach(async ({ request }) => {
  await request.get("/__sim/reset");
});

const openAllSecs = async (page) => {
  if ((await page.locator("[data-act=secAll]").count()) && (await page.locator("[data-act=secAll]").textContent()) === "Apri tutto") await page.locator("[data-act=secAll]").click();
};

test("ticket: la ricerca filtra per rif., titolo o chiave senza perdere il cursore", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Backlog");
  await openAllSecs(page);
  const rows = page.locator('#main tr[data-k^="t-"]:not([hidden])');
  const all = await rows.count();
  const search = page.locator("#tSearch");
  await search.fill("T-002");
  await expect(rows).toHaveCount(1);
  await expect(search).toBeFocused();
  await expect(page.locator("#main .dt tbody:not([hidden])")).toHaveCount(1);
  await search.fill("calendar");
  expect(await rows.count()).toBeGreaterThan(0);
  for (const t of await rows.locator(".dt-t").first().allTextContents()) expect(t.toLowerCase()).toContain("calendar");
  await search.fill("");
  await expect(rows).toHaveCount(all);
});

test("ticket: selezione con le caselle, modifica in blocco con «Annulla», eliminazione delle sole bozze con ripristino", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Backlog");
  await openAllSecs(page);
  // le prime tre bozze
  const ids = await page.evaluate(() => ticketList().filter((t) => t.state !== "created").slice(0, 3).map((t) => t.id));
  for (const id of ids) await page.locator(`.t-pick[value="${id}"]`).check();
  await expect(page.locator(".sp")).toHaveCount(0); // la casella non apre il pannello
  const bar = page.locator(".t-bar");
  await expect(bar).toContainText("3 ticket selezionati");
  await bar.locator("#tbWork").selectOption("Logic");
  await bar.locator("#tbLabel").fill("Manual_Test");
  await bar.getByRole("button", { name: "Applica" }).click();
  await expect(page.locator("#toast")).toContainText("Aggiornati 3 ticket.");
  const after = await page.evaluate((ids) => ids.map((id) => [S.tickets[id].work, S.tickets[id].labels.includes("Manual_Test")]), ids);
  expect(after).toEqual([["Logic", true], ["Logic", true], ["Logic", true]]);
  const works = await page.evaluate((ids) => ids.map((id) => S.tickets[id].work), ids);
  await page.locator(".toast-undo").click();
  await expect(page.locator("#toast")).toHaveText("Modifiche annullate.");
  expect(await page.evaluate((ids) => ids.map((id) => S.tickets[id].work), ids)).not.toEqual(works);
  // eliminazione in blocco con conferma e ripristino
  const n = await page.evaluate(() => ticketList().length);
  const del = bar.locator("[data-act=tBulkDel]");
  await expect(del).toHaveText("Elimina 3 bozze");
  await del.click();
  await expect(del).toHaveText("Conferma: elimina 3 bozze");
  await del.click();
  await expect(page.locator("#toast")).toContainText("Eliminate 3 bozze.");
  expect(await page.evaluate(() => ticketList().length)).toBe(n - 3);
  await page.locator(".toast-undo").click();
  await expect(page.locator("#toast")).toHaveText("Ripristinati 3 elementi.");
  expect(await page.evaluate(() => ticketList().length)).toBe(n);
  // «Seleziona tutti» prende solo i visibili
  await page.locator("#tSearch").fill("T-00");
  await page.locator("#tAll").check();
  const vis = await page.locator('#main tr[data-k^="t-"]:not([hidden])').count();
  await expect(page.locator(".t-bar")).toContainText(`${vis} ticket selezionati`);
  await page.locator(".t-bar").getByRole("button", { name: "Annulla" }).click();
  await expect(page.locator(".t-bar")).toHaveCount(0);
});

test("eliminazione di una domanda con «Annulla»: torna com'era; niente più «Elimina» dentro la domanda", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Domande di apertura");
  await openAllSecs(page);
  const q = await page.evaluate(() => arr("questions")[0]);
  const row = page.locator(".q-row", { has: page.locator(`.q-pick[value="${q.id}"]`) });
  await row.hover();
  await row.locator(".q-del").click();
  await row.locator(".q-del").click();
  await expect(page.locator("#toast")).toContainText("Domanda eliminata.");
  await page.locator(".toast-undo").click();
  expect(await page.evaluate((id) => S.questions[id]?.q, q.id)).toBe(q.q);
  // la domanda aperta non ha più il vecchio «Elimina» interno
  await expect(page.locator("#main [data-act=delQ]")).toHaveCount(0);
});

test("kit: «Parti da un kit esistente» aggiunge release ed epiche che mancano da un modello, con «Annulla»", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Kit di progetto");
  const before = await page.evaluate(() => ({ r: K().releases.map((x) => x.name), e: K().epics.length }));
  await page.locator("[data-act=kitImport]").click();
  const panel = page.locator(".sp");
  await panel.locator("#kiSrc").selectOption("tpl:iot");
  await expect(panel).toContainText("Provisioning dei dispositivi");
  await panel.locator('.ki-part[value="epics"]').check();
  const go = panel.locator("[data-act=kitImportRun]");
  await go.click();
  await expect(go).toHaveText("Conferma: copia nel kit");
  await go.click();
  await expect(page.locator("#toast")).toContainText("Kit aggiornato");
  const after = await page.evaluate(() => ({ r: K().releases.map((x) => x.name), e: K().epics.map((x) => [x.name, x.key]) }));
  expect(after.r).toEqual([...before.r, ...["Prototipo", "Release 1.0"].filter((x) => !before.r.includes(x))]);
  expect(after.e.find(([n]) => n === "Telemetria")).toEqual(["Telemetria", ""]);
  await page.locator(".toast-undo").click();
  expect(await page.evaluate(() => K().epics.length)).toBe(before.e);
});

test("kit da un altro progetto: riempie i campi vuoti, non copia le chiavi Jira, con «Sostituisci» sovrascrive", async ({ page }) => {
  await openStudio(page);
  const r = await page.evaluate(() => {
    const k = clone(K());
    k.envs = ""; k.glossary = "già scritto";
    const src = { envs: "Dev, Prod", glossary: "altro", links: { relates: "Relates", blocks: "Blocks" }, releases: [{ name: "Release 9", label: "Release9", key: "X-1" }], epics: [{ name: "Nuova area", release: "Release 9", key: "COM-999", linkedTo: "COM-1" }] };
    const n = kitMerge(k, src, { rules: true, releases: true, epics: true }, false);
    const k2 = clone(K()); kitMerge(k2, src, { rules: true, releases: false, epics: false }, true);
    return { n, envs: k.envs, glossary: k.glossary, epic: k.epics.find((e) => e.name === "Nuova area"), rel: k.releases.find((x) => x.name === "Release 9"), over: k2.glossary };
  });
  expect(r.n).toEqual({ rel: 1, ep: 1 });
  expect(r.envs).toBe("Dev, Prod");
  expect(r.glossary).toBe("già scritto");
  expect(r.epic).toEqual({ name: "Nuova area", release: "Release 9", key: "" });
  expect(r.rel).toEqual({ name: "Release 9", label: "Release9", date: "" });
  expect(r.over).toBe("altro");
});

test("Backlog: le esportazioni stanno in un solo menu; nel passo Crea c'è «Sincronizza e verifica» e niente «Svuota» in Qualità", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Backlog");
  await openAllSecs(page);
  await expect(page.locator("#main [data-act=exportTickets]")).toBeHidden();
  await page.locator(".exp-btn").click();
  await expect(page.locator(".exp-dd [role=menuitem]")).toHaveText(["Backlog in CSV", "Schede QA e piano di test (.zip)"]);
  await page.keyboard.press("Escape");
  await page.locator("[data-act=bTab][data-tab=quality]").click();
  await expect(page.locator("#qaAutoBox")).toBeChecked();
  await expect(page.locator("[data-act=clearQuality]")).toHaveCount(0);
  await goToStep(page, "Crea su Jira");
  await expect(page.locator("[data-act=runVerify]")).toHaveCount(0);
});

test("qualità automatica: dopo una modifica Tessa rilegge solo i ticket cambiati e aggiorna le segnalazioni", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Backlog");
  const res = await page.evaluate(async () => {
    const asked = [];
    window.ask = async (prompt) => { asked.push(prompt); const ref = prompt.match(/TICKET DA ANALIZZARE:\n(T-\d+)/)[1]; return { findings: [{ ref, type: "vague_acceptance", severity: "high", message: "Criteri vaghi", suggestion: "Riscrivili" }] }; };
    SAMPLE = SAMPLE || { ok: true };
    await full("meta", "quality");
    const ts = ticketList();
    saveMeta("quality", { at: Date.now(), count: ts.length, findings: [{ id: "x", ref: ts[5].ref, type: "other", severity: "low", message: "vecchia", suggestion: "", status: "open" }], seen: Object.fromEntries(ts.map((t) => [t.ref, tfp(t)])) });
    const t = ts[0];
    put("tickets", t.id, { ...S.tickets[t.id], title: S.tickets[t.id].title + " v2" });
    await qaAuto();
    return { asked: asked.length, refs: S.quality.findings.map((f) => f.ref), first: t.ref, other: ts[5].ref, seen: S.quality.seen[t.ref] === tfp(S.tickets[t.id]) };
  });
  expect(res.asked).toBe(1);
  expect(res.refs.sort()).toEqual([res.first, res.other].sort());
  expect(res.seen).toBe(true);
  // spento dalla scheda Qualità, non parte più
  await page.locator("[data-act=bTab][data-tab=quality]").click();
  await page.locator("#qaAutoBox").uncheck();
  await expect(page.locator("#toast")).toHaveText("Controllo automatico spento.");
  const again = await page.evaluate(async () => { let n = 0; window.ask = async () => { n++; return { findings: [] }; }; const t = ticketList()[1]; put("tickets", t.id, { ...S.tickets[t.id], title: S.tickets[t.id].title + " v3" }); await qaAuto(); return n; });
  expect(again).toBe(0);
});
