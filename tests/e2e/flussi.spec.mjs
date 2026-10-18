// Flussi di Trama non coperti dal percorso principale: modifiche a mano, salvataggio, Domande, Kit, Backlog,
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

  await page.evaluate(() => BS.writesDone()); // il salvataggio è arrivato al server
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

test("Domande di apertura: si eliminano dalla riga chiusa, una o in gruppo, senza aprirle", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Domande di apertura");
  const open = await page.locator("[data-act=secAll]").textContent();
  if (open === "Apri tutto") await page.locator("[data-act=secAll]").click();
  const rows = page.locator("#main .q-row");
  const n = await rows.count();
  expect(n).toBeGreaterThan(3);
  // a riposo casella e cestino non si vedono e non spostano nulla
  const first = rows.nth(0);
  await page.mouse.move(0, 0);
  await expect(first.locator(".q-del")).toHaveCSS("opacity", "0");
  const box = await first.locator("summary .ttl").boundingBox();
  await first.hover();
  await expect(first.locator(".q-del")).toHaveCSS("opacity", "1");
  expect(await first.locator("summary .ttl").boundingBox()).toEqual(box);
  // casella e titolo sulla stessa riga
  const cb = await first.locator(".q-pick").boundingBox();
  expect(Math.abs(cb.y + cb.height / 2 - (box.y + box.height / 2))).toBeLessThan(3);

  // una sola: due clic sul cestino, la riga resta chiusa
  const id = await first.locator(".q-pick").getAttribute("value");
  await first.locator(".q-del").click();
  await expect(first.locator(".q-del")).toHaveText("Elimina?");
  await expect(page.locator(`#main details.item[data-k="q-${id}"]`)).not.toHaveAttribute("open", "");
  await first.locator(".q-del").click();
  await expect(page.locator("#toast")).toHaveText("Domanda eliminata.");
  await expect(rows).toHaveCount(n - 1);
  await expect(page.locator(`#main details.item[data-k="q-${id}"]`)).toHaveCount(0);

  // in gruppo: due caselle, poi la barra della selezione
  await rows.nth(0).locator(".q-pick").check();
  await expect(page.locator("#main .q-bar")).toContainText("1 domanda selezionata");
  await rows.nth(1).locator(".q-pick").check();
  const bar = page.locator("#main .q-bar");
  await expect(bar).toContainText("2 domande selezionate");
  await expect(rows.nth(2).locator(".q-pick")).toHaveCSS("opacity", "1"); // con una selezione attiva le caselle restano visibili
  await bar.getByRole("button", { name: "Annulla" }).click();
  await expect(bar).toHaveCount(0);
  await rows.nth(0).locator(".q-pick").check();
  await page.locator("#main .q-bar [data-act=qSelAll]").click();
  await expect(page.locator("#main .q-bar")).toContainText(`${n - 1} domande selezionate`);
  await page.locator("#main .q-bar [data-act=qSelNone]").click();
  await rows.nth(0).locator(".q-pick").check();
  await rows.nth(1).locator(".q-pick").check();
  const del = page.locator("#main .q-bar [data-act=qDelSel]");
  await del.click();
  await expect(del).toHaveText("Conferma: elimina 2 domande");
  await del.click();
  await expect(page.locator("#toast")).toHaveText("2 domande eliminate.");
  await expect(rows).toHaveCount(n - 3);
  await expect(page.locator("#main .q-bar")).toHaveCount(0);
  expect(await page.evaluate(() => arr("questions").length)).toBe(n - 3);
});

test("Domande di apertura: la casella si usa da tastiera e il focus resta sulla riga", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Domande di apertura");
  const open = await page.locator("[data-act=secAll]").textContent();
  if (open === "Apri tutto") await page.locator("[data-act=secAll]").click();
  const pick = page.locator("#main .q-row .q-pick").first();
  const id = await pick.getAttribute("value");
  await pick.focus();
  await expect(pick).toHaveCSS("opacity", "1");
  await page.keyboard.press("Space");
  await expect(page.locator("#main .q-bar")).toContainText("1 domanda selezionata");
  await expect(page.locator(`#main .q-pick[value="${id}"]`)).toBeFocused();
  await expect(page.locator(`#main .q-pick[value="${id}"]`)).toBeChecked();
});

test("Kit: rinominare una release la rinomina anche in epiche, requisiti e ticket", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Kit di progetto");
  const old = await page.evaluate(() => K().releases[1].name);
  const n = await page.evaluate((o) => ({ reqs: reqList().filter((x) => x.release === o).length, tickets: ticketList().filter((x) => x.release === o).length, epics: K().epics.filter((x) => x.release === o).length }), old);
  expect(n.reqs + n.tickets + n.epics).toBeGreaterThan(0);
  await openSec(page, "Release (= Fase)");
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
  // esco dai campi: Trama fa ora il ridisegno rimandato, così la conferma non scade durante un ridisegno lento (CI)
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

test("Crea su Jira: se Jira crea un'epica ma la risposta si perde, Trama la ritrova e non la duplica", async ({ page, request }) => {
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
  for (const start of ["/", "/brand", "/installazione", "/privacy", "/componenti", "/architettura", "/studio"]) {
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

test("salvataggio in blocco: rinominare una release aggiorna decine di elementi con una sola richiesta, salvata sul server", async ({ page, request }) => {
  await openStudio(page);
  const writes = [];
  page.on("request", (r) => { if (["PUT", "POST", "DELETE"].includes(r.method()) && r.url().includes("/api/projects/")) writes.push(`${r.method()} ${new URL(r.url()).pathname.split("/").slice(3).join("/")}`); });
  await goToStep(page, "Kit di progetto");
  const old = await page.evaluate(() => K().releases[0].name);
  const touched = await page.evaluate((o) => reqList().filter((x) => x.release === o).length + ticketList().filter((x) => x.release === o).length, old);
  expect(touched).toBeGreaterThan(20);
  await openSec(page, "Release (= Fase)");
  const name = page.locator('[data-bind="meta:kit:releases.0.name"]');
  await name.fill(`${old} bis`);
  await name.press("Tab");
  await page.evaluate(() => BS.writesDone());
  expect(writes.filter((w) => w.startsWith("POST") && w.endsWith("/batch")).length, writes.join("\n")).toBe(1);
  expect(writes.length, "nessuna richiesta per singolo elemento").toBeLessThanOrEqual(2);
  const saved = (await (await request.get("/api/projects/progetto-prova")).json()).items;
  expect(saved.filter((i) => (i.col === "reqs" || i.col === "tickets") && i.data.release === old)).toHaveLength(0);
  expect(saved.filter((i) => (i.col === "reqs" || i.col === "tickets") && i.data.release === `${old} bis`)).toHaveLength(touched);
});

test("sincronizzazione: ogni 6 secondi mentre si lavora, ogni 30 dopo 2 minuti fermi, subito al ritorno", async ({ page }) => {
  await page.clock.install();
  const polls = [];
  page.on("request", (r) => { if (/\/api\/projects\/[^/]+\?since=/.test(r.url())) polls.push(r.url()); });
  await page.goto("/studio?p=progetto-prova");
  await expect(page.locator(".progress b")).toContainText("di 6 passi completati");
  // il tempo finto avanza a passi di 3 secondi, lasciando alle richieste vere il tempo di rispondere
  const during = async (ms) => { const n = polls.length; for (let t = 0; t < ms; t += 3000) { await page.clock.runFor(3000); await page.waitForTimeout(40); } return polls.length - n; };
  expect(await during(60_000)).toBeGreaterThanOrEqual(9); // primo minuto: rapido
  await during(70_000); // si supera la soglia dei 2 minuti
  expect(await during(60_000)).toBeLessThanOrEqual(2); // da fermo: ogni 30 secondi
  const n = polls.length;
  await page.keyboard.press("Shift"); // si torna a lavorare: sincronizza subito
  await page.clock.runFor(100);
  await expect.poll(() => polls.length).toBeGreaterThan(n);
  expect(await during(30_000)).toBeGreaterThanOrEqual(4);
});

test("chi chiude la scheda mentre un salvataggio è in corso riceve l'avviso del browser", async ({ page }) => {
  await openStudio(page);
  await page.route("**/api/projects/*/items/**", async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); }); // server lento
  await page.evaluate(() => { const [id, d] = Object.entries(S.reqs)[0]; put("reqs", id, { ...d, title: d.title + " (modificato)" }); });
  await page.waitForTimeout(100);
  const dialog = page.waitForEvent("dialog");
  await page.close({ runBeforeUnload: true });
  expect((await dialog).type()).toBe("beforeunload");
});

test("chat: l'assistente è Tessa e nella chat Claude non compare mai, in italiano e in inglese", async ({ page, context }) => {
  await openStudio(page);
  const fab = page.locator("#chatFab");
  await expect(fab).toHaveAttribute("aria-label", "Chiedi a Tessa: apri la chat");
  await expect(fab.locator(".tessa")).toHaveCount(1); // l'icona del filo nel labirinto
  await fab.click();
  const chat = page.locator("#chat");
  await expect(chat.locator(".chat-h h2")).toHaveText("Tessa");
  const visible = async () => [await chat.innerText(), await page.locator("#chatIn").getAttribute("placeholder"), await chat.getAttribute("aria-label"), await fab.getAttribute("aria-label")].join(" ");
  expect(await visible()).not.toMatch(/Claude/);
  await context.addInitScript(() => { try { localStorage.setItem("trama:lang", "en"); } catch {} });
  await page.reload();
  await expect(page.locator(".progress b")).toHaveText(/steps completed/);
  if ((await fab.getAttribute("aria-expanded")) !== "true") await fab.click(); // Trama ricorda se la chat era aperta
  await expect(chat.locator(".chat-h h2")).toHaveText("Tessa");
  await expect(fab).toHaveAttribute("aria-label", "Ask Tessa: close the chat");
  expect(await visible()).not.toMatch(/Claude/);
});

test("Scheda QA: dal pannello del ticket si vede, si copia e si scarica; dalla lista si scarica lo zip della release", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Backlog");
  const ref = await page.evaluate(() => ticketList().find((t) => t.type === "Story" && (t.links || []).length).ref);
  await page.locator(`#main tr[data-k^="t-"]`, { hasText: ref }).first().click();
  const box = page.locator(".sp .qa-box");
  await expect(box.locator("summary")).toContainText("Scheda QA");
  await box.locator("summary").click();
  const pre = box.locator(".qa-pre");
  await expect(pre).toContainText(`ref: ${ref}`);
  await expect(pre).toContainText("## Cosa verificare");
  await expect(pre).toContainText("- [ ] AC1 · ");
  await expect(pre).toContainText("## Da dove nasce");
  const [md] = await Promise.all([page.waitForEvent("download"), box.getByRole("button", { name: "Scarica .md" }).click()]);
  expect(md.suggestedFilename()).toMatch(/^(COM-\d+|T-\d+)-[a-z0-9-]+\.md$/);
  await expect(page.locator("#toast")).toHaveText("Scheda QA scaricata.");
  await page.keyboard.press("Escape");
  const [zip] = await Promise.all([page.waitForEvent("download"), page.locator("[data-act=qaZip]").click()]);
  expect(zip.suggestedFilename()).toBe("schede-qa-mvp-pilota.zip");
  await expect(page.locator("#toast")).toHaveText(/Scaricato il piano di test con \d+ schede QA\./);
  const buf = Buffer.concat(await (async () => { const out = []; for await (const c of await zip.createReadStream()) out.push(c); return out; })());
  expect(buf.subarray(0, 4).toString("hex")).toBe("504b0304");
  expect(buf.includes(Buffer.from("piano-di-test.md"))).toBe(true);
});
