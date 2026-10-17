// Flussi dello studio non coperti dal percorso principale: modifiche a mano, salvataggio, Domande, Kit, Backlog,
// esportazioni, resilienza della creazione su Jira, chat e collegamenti delle pagine pubbliche.
import { test, expect } from "@playwright/test";
import { openStudio, goToStep, openSec, toAck, runCreate, DONE, simState } from "./aiuti.mjs";

test.beforeEach(async ({ request }) => {
  await request.get("/__sim/reset");
});

const count = (page, fn) => page.evaluate(fn);

test("Requisiti: aggiunta a mano, modifica nel pannello, salvata dopo il ricaricamento, eliminata con conferma", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Requisiti");
  const before = await count(page, () => reqList().length);
  await openSec(page, "Estrazione dei requisiti");
  await page.getByRole("button", { name: "Aggiungi requisito a mano" }).click();
  const panel = page.locator(".sp");
  await expect(panel).toBeVisible();
  const title = panel.locator('[data-bind$=":title"]');
  await expect(title).toHaveValue("Nuovo requisito");
  await title.fill("Calendario delle semine");
  await title.press("Tab"); // il campo si salva quando lo lasci
  await expect.poll(() => count(page, () => reqList().length)).toBe(before + 1);

  await page.reload(); // salvato sul server, non solo nella pagina
  await expect(page.locator(".progress b")).toContainText("di 6 passi completati");
  await goToStep(page, "Requisiti");
  await openSec(page, /^Requisiti$/);
  await page.locator("#rqSearch").fill("Calendario delle semine");
  const row = page.locator('#main tr[data-k^="req-"]:visible');
  await expect(row).toHaveCount(1);
  await row.click();
  const del = panel.locator("[data-act=delReq]");
  await del.click();
  await expect(del).toHaveText("Conferma eliminazione"); // il primo clic non elimina
  expect(await count(page, () => reqList().length)).toBe(before + 1);
  await del.click();
  await expect.poll(() => count(page, () => reqList().length)).toBe(before);
});

test("Valida la lista: bloccata finché mancano release, poi registrata", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Requisiti");
  await page.getByRole("button", { name: "Valida la lista (PO)" }).click();
  await expect(page.locator("#main .msg").first()).toContainText("non hanno la release");
  await page.locator("[data-act=relQuick]").click();
  await page.locator("[data-act=relqAll]").click();
  await page.locator("[data-act=relqAll]").click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Valida la lista (PO)" }).click();
  await expect(page.locator("#main [data-act=validateReqs]")).toContainText("Validata il");
  await expect(page.locator("#recap .rc-st")).toContainText("Passo completato");
});

test("Domande di apertura: una risposta chiude la domanda e finisce da sola nel Registro", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Domande di apertura");
  // nel progetto di prova sono tutte chiuse: ne riapro una togliendo risposta e ipotesi
  const q = await page.evaluate(() => { const x = arr("questions")[0]; const { id, ...d } = x; put("questions", id, { ...d, answer: "", hypothesis: "" }); return x; });
  const open = await page.locator("[data-act=secAll]").textContent();
  if (open === "Apri tutto") await page.locator("[data-act=secAll]").click();
  const item = page.locator(`#main details.item[data-k="q-${q.id}"]`);
  await expect(item.locator(".pill")).toHaveText("Aperta");
  await item.locator(":scope > summary").click();
  const answer = item.locator(`[data-bind="questions:${q.id}:answer"]`);
  await answer.fill("Sì, anche in inglese dalla Release 1.0");
  await answer.press("Tab");
  await expect(page.locator(`#main details.item[data-k="q-${q.id}"] .pill`).first()).toHaveText("Risposta");
  await goToStep(page, "Registro decisioni");
  await expect(page.locator("#main table")).toContainText("Sì, anche in inglese dalla Release 1.0");
});

test("Kit: rinominare una release la rinomina anche in epiche, requisiti e ticket", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Kit di progetto");
  const old = await page.evaluate(() => K().releases[1].name);
  const n = await page.evaluate((o) => ({ reqs: reqList().filter((x) => x.release === o).length, tickets: ticketList().filter((x) => x.release === o).length, epics: K().epics.filter((x) => x.release === o).length }), old);
  expect(n.reqs + n.tickets + n.epics).toBeGreaterThan(0);
  await openSec(page, "Release (= Fasi in Jira)");
  const name = page.locator('[data-bind="meta:kit:releases.1.name"]');
  await name.fill(`${old} GA`);
  await name.press("Tab");
  await expect.poll(() => page.evaluate((o) => reqList().filter((x) => x.release === o).length + ticketList().filter((x) => x.release === o).length + K().epics.filter((x) => x.release === o).length, old)).toBe(0);
  const now = await page.evaluate((v) => ({ reqs: reqList().filter((x) => x.release === v).length, tickets: ticketList().filter((x) => x.release === v).length, epics: K().epics.filter((x) => x.release === v).length }), `${old} GA`);
  expect(now).toEqual(n);
});

test("Backlog: un ticket a mano mostra cosa manca, si corregge nel pannello e si elimina con conferma", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Backlog");
  const before = await count(page, () => ticketList().length);
  await page.getByRole("button", { name: "Aggiungi a mano" }).first().click();
  const panel = page.locator(".sp");
  await expect(panel).toBeVisible();
  const errs = panel.locator(".issues .pill.err");
  const e0 = await errs.count();
  await expect(errs).toContainText(["Titolo mancante", "Epica mancante (K3)"]);
  const title = panel.locator('[data-bind$=":title"]');
  await title.fill("Esportare il diario in PDF");
  await title.press("Tab");
  const epic = panel.locator('select[data-bind$=":epic"]');
  await epic.selectOption({ index: 1 });
  await expect(errs).toHaveCount(0); // «cosa manca» si aggiorna mentre si compila, senza uscire dal pannello
  expect(e0).toBeGreaterThan(0);
  // esco dai campi: lo studio fa ora il ridisegno rimandato, così la conferma non scade durante un ridisegno lento (CI)
  await panel.locator(".sp-t").click();
  await expect(panel.locator('select[data-bind$=":epic"]')).toHaveValue(await epic.inputValue());
  const del = panel.locator("[data-act=delTicket]");
  await del.click();
  await expect(del).toHaveText("Conferma eliminazione");
  await del.click();
  await expect.poll(() => count(page, () => ticketList().length)).toBe(before);
});

test("Esportazioni CSV: requisiti, ticket e decisioni con intestazione e una riga per elemento", async ({ page }) => {
  await openStudio(page);
  const csv = async (step, file, sec) => {
    await goToStep(page, step);
    if (sec) await openSec(page, sec);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.locator(`[data-act=${file}]`).first().click()]);
    const text = await (await dl.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8"));
    return { name: dl.suggestedFilename(), lines: text.replace(/^﻿/, "").split("\r\n") };
  };
  const reqs = await csv("Requisiti", "exportReqs", "Estrazione dei requisiti");
  expect(reqs.name).toBe("requisiti.csv");
  expect(reqs.lines[0]).toContain('"ID","Titolo"');
  expect(reqs.lines.length).toBe((await count(page, () => reqList().length)) + 1);
  const tickets = await csv("Backlog", "exportTickets");
  expect(tickets.name).toMatch(/\.csv$/);
  expect(tickets.lines.length).toBe((await count(page, () => ticketList().length)) + 1);
  const dec = await csv("Registro decisioni", "exportDecisions");
  expect(dec.lines.length).toBe((await count(page, () => arr("decisions").length)) + 1);
});

test("Crea su Jira: se Jira crea un'epica ma la risposta si perde, lo studio la ritrova e non la duplica", async ({ page, request }) => {
  test.setTimeout(180_000);
  await request.post("/__sim/fault", { data: { kind: "afterCreate500", type: "Feature Epic", times: 2 } });
  await openStudio(page);
  await goToStep(page, "Crea su Jira");
  await toAck(page);
  await runCreate(page);
  await expect(page.locator("#main")).toContainText(DONE, { timeout: 150_000 });
  const st = await simState(request);
  const epics = st.issues.filter((i) => i.type === "Feature Epic").map((i) => i.summary);
  expect(new Set(epics).size, "nessuna epica doppia").toBe(epics.length);
  expect(await page.evaluate(() => K().epics.filter((e) => e.key).length), "ogni epica creata ha la sua chiave").toBe(epics.length);
  await expect(page.locator("#main .log")).toContainText("esiste già come");
});

test("Crea su Jira: un ticket con esito incerto si ferma, «Cerca in Jira» lo ritrova senza crearne un doppione", async ({ page, request }) => {
  test.setTimeout(180_000);
  await request.post("/__sim/fault", { data: { kind: "afterCreate500", type: "Story", times: 1 } });
  await openStudio(page);
  await goToStep(page, "Crea su Jira");
  await toAck(page);
  await runCreate(page);
  const esito = page.locator('#main details.sec[data-sec="create:esito-della-creazione"]');
  await expect(esito).toContainText("Ticket da sistemare", { timeout: 150_000 });
  const t = await page.evaluate(() => ticketList().find((x) => x.state === "unknown"));
  expect(t, "il ticket incerto è segnalato, non dato per creato").toBeTruthy();
  await openSec(page, "Esito della creazione");
  await esito.getByRole("button", { name: "Cerca in Jira" }).click();
  await expect.poll(() => page.evaluate((id) => S.tickets[id].state, t.id), { timeout: 20_000 }).toBe("created");
  const st = await simState(request);
  const title = await page.evaluate((id) => fullTitle({ ...S.tickets[id], id }), t.id);
  expect(st.issues.filter((i) => i.summary === title).length, "un solo ticket in Jira").toBe(1);
});

test("Chat: si apre dal pulsante, si chiude con Esc e il pulsante dice in che stato è", async ({ page }) => {
  await openStudio(page);
  const fab = page.locator("#chatFab");
  await expect(fab).toHaveAttribute("aria-expanded", "false");
  await fab.click();
  await expect(page.locator("#chat")).toHaveClass(/open/);
  await expect(fab).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#chatIn")).toBeVisible();
  await page.locator("#chatIn").press("Escape");
  await expect(page.locator("#chat")).not.toHaveClass(/open/);
  await expect(fab).toHaveAttribute("aria-expanded", "false");
});

test("pagine pubbliche: ogni collegamento interno porta a una pagina che esiste", async ({ page, request }) => {
  const seen = new Set(), broken = [];
  for (const start of ["/", "/brand", "/installazione", "/privacy", "/componenti", "/studio"]) {
    await page.goto(start);
    const links = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    for (const href of links) {
      const u = new URL(href, page.url());
      if (u.origin !== new URL(page.url()).origin || u.pathname.startsWith("/api/")) continue;
      if (u.hash && u.pathname === new URL(page.url()).pathname) {
        if (!(await page.locator(`[id="${decodeURIComponent(u.hash.slice(1))}"]`).count())) broken.push(`${start} → ${href} (ancora mancante)`);
        continue;
      }
      if (seen.has(u.pathname)) continue;
      seen.add(u.pathname);
      const r = await request.get(u.pathname);
      if (r.status() !== 200) broken.push(`${start} → ${href} (${r.status()})`);
    }
  }
  expect(broken).toEqual([]);
  expect(seen.size).toBeGreaterThan(4);
});
