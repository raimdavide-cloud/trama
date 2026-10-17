// Percorso principale dello studio sul progetto di prova (tests/fixtures/progetto-prova.json).
import { test, expect } from "@playwright/test";
import { PROJECT, openStudio, goToStep, openSec, toAck, runCreate } from "./aiuti.mjs";

test.beforeEach(async ({ request }) => {
  await request.get("/__sim/reset");
});

test("la pagina dei progetti mostra le schede e le azioni nel menu", async ({ page }) => {
  await page.goto("/studio");
  await expect(page.getByRole("heading", { name: "I tuoi progetti" })).toBeVisible();
  const card = page.locator(".proj-card", { hasText: "Test Prova" });
  await expect(card).toContainText("requisiti");
  await expect(card.locator(".key")).toHaveText("COM");
  await card.getByRole("button", { name: /Altre azioni/ }).click();
  await expect(card.getByRole("menuitem", { name: "Elimina progetto" })).toBeVisible();
  await page.getByRole("button", { name: "+ Nuovo progetto" }).first().click();
  await expect(page.locator("#npName")).toBeFocused();
});

test("Trama ha 6 passi più il Registro, e ricorda il passo aperto", async ({ page }) => {
  await openStudio(page);
  const steps = page.locator("#stepList .st");
  await expect(steps).toHaveCount(7);
  await expect(steps.last()).toContainText("Registro decisioni");
  await goToStep(page, "Kit di progetto");
  await expect(page.locator("#main .eyebrow").first()).toContainText("Passo 4 di 6");
  await page.reload();
  await expect(page.locator("#main h1")).toContainText("Compila il kit di progetto");
});

test("i requisiti si filtrano per stato e si cercano per titolo", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Requisiti");
  const rows = page.locator('#main tr[data-k^="req-"]:visible');
  const total = await rows.count();
  expect(total).toBeGreaterThan(10);

  await page.locator("#rqShow").selectOption("norel");
  await expect(page.locator("#rqCount")).toContainText(`di ${total} requisiti`);
  const filtered = await rows.count();
  expect(filtered).toBeLessThan(total);

  const first = (await rows.first().locator("td.dt-t").first().textContent()).trim();
  await page.locator("[data-act=rqReset]").click();
  await page.locator("#rqSearch").fill(first.slice(0, 12));
  await expect(page.locator("#rqSearch")).toBeFocused(); // la ricerca non ridisegna la pagina
  expect(await rows.count()).toBeGreaterThanOrEqual(1);
  expect(await rows.count()).toBeLessThan(total);
});

test("tabelle compatte: il pannello si apre, scorre con le frecce, si chiude con Esc", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Requisiti");
  const rows = page.locator('#main tr[data-k^="req-"]');
  const code = (await rows.nth(0).locator(".key").textContent()).trim();
  const next = (await rows.nth(1).locator(".key").textContent()).trim();
  await rows.nth(0).click();
  const panel = page.locator(".sp");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".sp-t")).toContainText(code);
  await expect(panel.locator("textarea").first()).toBeVisible(); // il modulo completo è nel pannello
  await page.keyboard.press("ArrowDown");
  await expect(panel.locator(".sp-t")).toContainText(next);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".sp .sp-t")).toContainText(next);
});

test("le modifiche fatte nel pannello restano salvate sulla riga giusta", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Requisiti");
  await page.locator("#rqShow").selectOption("norel");
  const row = page.locator('#main tr[data-k^="req-"]').first();
  const code = (await row.locator(".key").textContent()).trim();
  await row.click();
  const release = page.locator('.sp select[data-bind$=":release"]');
  await expect(release).toHaveAttribute("data-bind", /^reqs:[^:]+:release$/);
  await expect(release).not.toHaveAttribute("data-bind", /undefined/);
  const options = await release.locator("option").allTextContents();
  expect(options.length, "il menu deve offrire tutte le release, non solo quella attuale").toBeGreaterThan(2);
  const chosen = options[options.length - 1];
  await release.selectOption({ label: chosen });
  await page.keyboard.press("Escape");
  await page.locator("[data-act=rqReset]").click();
  await expect(page.locator(`#main tr[data-k^="req-"]`, { hasText: code })).toContainText(chosen);

  await goToStep(page, "Backlog");
  const trow = page.locator('#main tr[data-k^="t-"]').first();
  await trow.click();
  const title = page.locator('.sp input[data-bind$=":title"]');
  await expect(title).not.toHaveAttribute("data-bind", /undefined/);
  await title.fill("Edited title from the side panel");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  await expect(page.locator('#main tr[data-k^="t-"]').first()).toContainText("Edited title from the side panel");
});

test("tracciabilità: dal requisito ai suoi ticket nel Backlog", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Requisiti");
  const cell = page.locator("#main tr[data-k^='req-'] [data-act=reqTickets]").first();
  const code = (await cell.locator("xpath=ancestor::tr").locator(".key").textContent()).trim();
  await cell.click();
  await expect(page.locator("#main h1")).toContainText("Scomponi i requisiti in ticket");
  await expect(page.locator(".list-bar")).toContainText(`Solo ${code}`);
  await expect(page.locator("#main .dt-g")).toHaveCount(1);
  const tickets = page.locator('#main tr[data-k^="t-"]');
  expect(await tickets.count()).toBeGreaterThan(0);
  await tickets.first().click();
  await expect(page.locator(".sp")).toContainText("Descrizione");
  await page.locator("[data-act=bReqClear]").click();
  expect(await page.locator("#main .dt-g").count()).toBeGreaterThan(1);
});

test("Crea su Jira: anteprima a colonne, poi struttura completa e collegata", async ({ page, request }) => {
  test.setTimeout(180_000); // crea circa 90 elementi e 100 collegamenti: sulla CI è più lento che in locale
  await openStudio(page);
  await goToStep(page, "Crea su Jira");
  await expect(page.locator('#main details.sec[data-sec="create:controllo-prima-della-creazione"]')).toHaveAttribute("open", ""); // il controllo parte da solo
  const cols = page.locator(".sc .sc-c");
  await expect(cols).toHaveCount(4);
  await toAck(page); // passa dall'anteprima
  await openSec(page, "Anteprima");
  const epic = cols.nth(2).locator(".sc-b").nth(1);
  await epic.click();
  await expect(cols.nth(2).locator(".sc-b").nth(1)).toHaveClass(/sel/);
  await runCreate(page);
  await expect(page.locator("#main")).toContainText(/Verifica: \d+ di \d+ ticket con tutti i campi salvati/, { timeout: 150_000 });
  // dopo la creazione: esito e sincronizzazione sono sezioni numerate, niente blocchi sparsi
  await expect(page.locator("#main details.sec .sec-t")).toHaveText(["Controllo prima della creazione", "Anteprima", "Ipotesi e scelte fatte al tuo posto", "Crea su Jira", "Esito della creazione", "Sincronizzazione con Jira"]);
  await expect(page.locator("#main > div.card")).toHaveCount(0);
  const esito = page.locator('#main details.sec[data-sec="create:esito-della-creazione"]');
  await expect(esito.locator(".sec-b details.item summary")).toContainText(["Riepilogo per il PO", "Struttura in Jira", "Ticket creati"]);

  const state = await (await request.get("/__sim/state")).json();
  const byType = state.issues.reduce((m, i) => ((m[i.type] = (m[i.type] || 0) + 1), m), {});
  expect(byType.Project).toBe(1);
  expect(byType.Fase).toBeGreaterThanOrEqual(1);
  expect(byType["UX Story"], "i ticket di design nascono in Jira come UX Story").toBeGreaterThan(0);
  expect(byType.Spike).toBeUndefined();
  expect(state.issues.length).toBeGreaterThan(40);
  const keys = new Set(state.issues.map((i) => i.key));
  for (const i of state.issues) if (i.type !== "Project") expect(keys.has(i.parent), `${i.key} senza padre`).toBe(true);
  expect(state.links.length).toBeGreaterThan(0);
});

test("le Regole del playbook stanno in una pagina a sé, fuori dai passi", async ({ page }) => {
  await openStudio(page);
  await expect(page.locator("#main")).not.toContainText("Regole del playbook di questo passo");
  await page.locator("#rulesBtn").click();
  await expect(page.locator("#main h1")).toHaveText("Regole del playbook");
  await expect(page.locator(".rules-sec")).toHaveCount(7);
  await expect(page.locator("#stepList .st.cur")).toHaveCount(0);
  await page.locator("[data-act=closeRules]").click();
  await expect(page.locator("#main h1")).not.toHaveText("Regole del playbook");
});

test("il Registro apre il modulo dal pulsante e aggiunge la decisione", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Registro decisioni");
  await expect(page.locator("#decForm")).toHaveCount(0);
  await page.locator("[data-act=decForm]").click();
  await expect(page.locator("#dText")).toBeFocused();
  await page.locator("#dText").fill("Le notifiche push restano fuori dall'MVP");
  await page.locator("[data-act=addDecision]").click();
  await expect(page.locator("#decForm")).toHaveCount(0);
  await expect(page.locator("#main table")).toContainText("Le notifiche push restano fuori dall'MVP");
});

test("barra in alto: menu del progetto con Apri in Jira e verifica dei collegamenti", async ({ page }) => {
  await openStudio(page);
  await page.locator("#projBtn").click();
  await expect(page.getByRole("menuitem", { name: /Apri in Jira/ })).toHaveAttribute("href", /\/browse\/COM$/);
  await page.keyboard.press("Escape");
  await expect(page.locator("#projMenu")).toBeHidden();

  await page.locator("#userBtn").click();
  await page.getByRole("menuitem", { name: "Verifica prima della demo" }).click();
  const list = page.locator(".health-l li");
  await expect(list).toHaveCount(4, { timeout: 20_000 });
  await expect(list.filter({ hasText: "Jira raggiungibile" })).toHaveClass(/ok/);
  await expect(list.filter({ hasText: "Dati salvati e condivisi" })).toHaveClass(/ok/);
});

test("solo desktop: sotto i 900 px Trama mostra l'avviso", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto(PROJECT);
  await expect(page.getByRole("heading", { name: "Trama è pensato per il computer" })).toBeVisible();
  await expect(page.locator(".app")).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator(".app")).toBeVisible();
});

test("Kit: cambiare la release (= Fase) di un'epica la sposta in Jira con i suoi ticket, dopo conferma", async ({ page, request }) => {
  test.setTimeout(240_000);
  await openStudio(page);
  // 1. struttura e ticket in Jira
  await goToStep(page, "Crea su Jira");
  await toAck(page);
  await runCreate(page);
  await expect(page.locator("#main")).toContainText(/Verifica: \d+ di \d+ ticket con tutti i campi salvati/, { timeout: 150_000 });
  let state = await (await request.get("/__sim/state")).json();
  const epic0 = state.issues.find((i) => i.summary === "Diario colturale");
  const tickets0 = state.issues.filter((i) => i.parent === epic0.key);
  expect(tickets0.length).toBeGreaterThan(0);
  expect(tickets0.every((t) => t.labels.includes("Release1"))).toBe(true);

  // 2. nel Kit un solo menu «Release (= Fase)»; la Fase non si sceglie più a parte
  await goToStep(page, "Kit di progetto");
  const epiche = await openSec(page, "Epiche");
  await expect(epiche.locator("th", { hasText: "Release (= Fase)" })).toBeVisible();
  await expect(page.locator('#main select[data-bind$=".phase"]')).toHaveCount(0);
  const i = await page.evaluate(() => K().epics.findIndex((e) => e.name === "Diario colturale"));
  await page.locator(`select[data-bind="meta:kit:epics.${i}.release"]`).selectOption("Release 1.0");
  const card = page.locator("#epicMove");
  await expect(card).toContainText("Aggiornare anche Jira?");
  await expect(card).toContainText("Release2");
  state = await (await request.get("/__sim/state")).json();
  expect(state.issues.find((x) => x.key === epic0.key).parent, "senza conferma Jira non cambia").toBe(epic0.parent);

  // 3. conferma: Jira aggiornato e verificato
  await card.locator("[data-act=epicMoveRun]").click();
  await expect(page.locator("#main .msg").first()).toContainText("spostata nella Fase", { timeout: 60_000 });
  state = await (await request.get("/__sim/state")).json();
  const phase = state.issues.find((x) => x.type === "Fase" && x.summary === "Release 1.0");
  expect(phase, "la Fase della nuova release viene creata").toBeTruthy();
  const epic = state.issues.find((x) => x.key === epic0.key);
  expect(epic.parent).toBe(phase.key);
  for (const t of [epic, ...state.issues.filter((x) => x.parent === epic.key)]) {
    expect(t.labels, t.key).toContain("Release2");
    expect(t.labels, t.key).not.toContain("Release1");
  }
  await goToStep(page, "Registro decisioni");
  await expect(page.locator("#main table")).toContainText("Diario colturale");
});

test("niente più Spike: i ticket di design sono UX Story, anche nei progetti creati prima", async ({ page }) => {
  await openStudio(page); // i dati di prova hanno ancora ticket «Spike»: lo studio li converte all'apertura
  for (const name of ["Progetto Jira", "Requisiti", "Domande di apertura", "Kit di progetto", "Backlog", "Crea su Jira", "Registro decisioni"]) {
    await page.locator("#stepList .st", { hasText: name }).click();
    await expect(page.locator("#main"), name).not.toContainText(/spike/i);
  }
  await page.locator("#stepList .st", { hasText: "Kit di progetto" }).click();
  await expect(page.locator('select[data-bind="meta:kit:types.UX Story"]')).toHaveValue("UX Story");
  await page.locator("#stepList .st", { hasText: "Backlog" }).click();
  expect(await page.locator("#main .dt .pill", { hasText: "UX Story" }).count()).toBeGreaterThan(0);
  const types = await page.evaluate(() => [...new Set(ticketList().map((t) => t.type))]);
  expect(types).not.toContain("Spike");
});

test("stepper nei passi: uno step aperto alla volta, riassunto con Modifica e memoria della scelta", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Requisiti");
  const secs = page.locator("#main details.sec");
  await expect(secs).toHaveCount(3);
  await expect(secs.nth(2)).toHaveAttribute("open", ""); // studio compilato: si apre lo step su cui si lavora
  await expect(page.locator("#main details.sec[open]")).toHaveCount(1);
  await expect(secs.nth(2).locator(":scope > summary")).toContainText("senza release"); // stato nel titolo
  await expect(secs.nth(0).locator(":scope > summary")).toContainText("Modifica"); // completato: riassunto e Modifica
  await expect(page.locator("[data-act=secAll]")).toHaveCount(0); // niente «Apri tutto» nello stepper
  await secs.nth(0).locator(":scope > summary").click(); // aprire uno step chiude gli altri
  await expect(secs.nth(0)).toHaveAttribute("open", "");
  await expect(page.locator("#main details.sec[open]")).toHaveCount(1);
  await secs.nth(0).locator(".sec-go").click(); // Continua apre lo step successivo
  await expect(secs.nth(1)).toHaveAttribute("open", "");
  await page.reload(); // la scelta resta
  await expect(page.locator(".progress b")).toContainText("di 6 passi completati");
  await expect(page.locator("#main details.sec").nth(1)).toHaveAttribute("open", "");
  // livello 2: i documenti sono righe dentro lo step, non schede
  const docs = await openSec(page, "Documenti");
  await expect(docs.locator(".sec-b details.item").first()).toBeVisible();
});

test("riepilogo a destra: numeri del backlog e un solo pulsante principale", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Kit di progetto");
  const rc = page.locator("#recap");
  await expect(rc).toBeVisible();
  await expect(rc.locator(".rc-l")).toContainText("Epiche");
  await expect(rc.locator(".rc-st")).toContainText("Passo completato");
  await expect(rc.locator(".rc-go")).toHaveClass(/primary/); // passo completo: «Prossimo» è il pulsante principale
  await expect(page.locator("#main details.sec[open] .sec-go.primary")).toHaveCount(0);
  await rc.locator(".rc-go").click();
  await expect(page.locator("#stepList .st.cur")).toContainText("Backlog");
  await goToStep(page, "Requisiti");
  await expect(rc.locator(".rc-st")).toContainText("Manca");
  await expect(rc.locator(".rc-go")).not.toHaveClass(/primary/);
});

test("sblocco progressivo: in un progetto nuovo gli step si sbloccano uno dopo l'altro", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Requisiti");
  const locked = page.locator("#main details.sec.locked summary .sec-t");
  await expect(locked).toHaveCount(0); // studio compilato: niente di bloccato
  // svuoto documenti e requisiti, come in uno studio appena creato
  const doc = await page.evaluate(() => { const [id, d] = Object.entries(S.docs)[0]; for (const c of ["docs", "reqs"]) for (const k of Object.keys(S[c])) del(c, k); return { id, d }; });
  await expect(locked).toHaveText(["Estrazione dei requisiti", "Requisiti"]);
  await expect(page.locator("#main details.sec.locked").first()).toContainText("Si sblocca quando carichi almeno un documento");
  const docs = page.locator("#main details.sec").first();
  await expect(docs).toHaveAttribute("open", "");
  const go = docs.locator(".sec-go");
  await expect(go).toHaveAttribute("aria-disabled", "true");
  await go.click({ force: true }); // bloccato: dice cosa manca
  await expect(docs.locator(".sec-why")).toHaveClass(/err/);
  await page.evaluate(({ id, d }) => put("docs", id, d), doc); // un documento caricato sblocca l'estrazione
  await expect(locked).toHaveText(["Requisiti"]);
  await expect(go).toHaveAttribute("aria-disabled", "false");
  await go.click();
  await expect(page.locator("#main details.sec").nth(1)).toHaveAttribute("open", "");
  await page.evaluate(({ id }) => del("docs", id), doc);
  await expect(locked).toHaveText(["Estrazione dei requisiti", "Requisiti"]);
  await openSec(page, "Documenti");
  await page.getByRole("button", { name: "Non ho documenti: aggiungo i requisiti a mano" }).click(); // senza documenti si parte a mano
  await expect(page.locator(".sp")).toBeVisible();
  await expect(locked).toHaveCount(0);
});

test("assegnazione rapida della release: un tasto per requisito, poi tutti i rimanenti con conferma", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Requisiti");
  const left = () => page.evaluate(() => reqList().filter((x) => !x.release).length);
  const before = await left();
  expect(before).toBeGreaterThan(2);
  await page.locator("[data-act=relQuick]").click();
  const panel = page.locator('.sp[data-panel="relq:all"]');
  await expect(panel.locator(".rq-qr")).toHaveCount(before);
  await expect(panel.locator(".rq-qr").first()).toBeFocused();
  await page.keyboard.press("1"); // prima release alla prima riga, poi passa alla successiva
  await page.keyboard.press("2");
  await expect.poll(left).toBe(before - 2);
  await expect(panel.locator(".rq-qr").nth(1).locator(".rq-qc.on")).toContainText(await page.evaluate(() => K().releases[1].name));
  await panel.locator(".rq-qr").first().locator(".rq-qc.on").click(); // un secondo clic toglie la release
  await expect.poll(left).toBe(before - 1);
  const last = await page.evaluate(() => K().releases.at(-1).name);
  await page.selectOption("#relqAll", last);
  const all = panel.locator("[data-act=relqAll]");
  await all.click(); // primo clic: chiede conferma
  await expect(all).toContainText(`Conferma: «${last}»`);
  await all.click();
  await expect.poll(left).toBe(0);
  await expect(panel.locator(".sp-t")).toContainText(`${before} di ${before} assegnati`);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-act=relQuick]")).toHaveCount(0); // nessun requisito resta senza release
});
