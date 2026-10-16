// Percorso principale dello studio sul progetto di prova (tests/fixtures/progetto-prova.json).
import { test, expect } from "@playwright/test";

const PROJECT = "/studio?p=progetto-prova";

test.beforeEach(async ({ request }) => {
  await request.get("/__sim/reset");
});

async function openStudio(page) {
  await page.goto(PROJECT);
  await expect(page.locator(".progress b")).toContainText("di 6 passi completati");
}
const goToStep = (page, name) => page.locator("#stepList .st", { hasText: name }).click();

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

test("lo studio ha 6 passi più il Registro, e ricorda il passo aperto", async ({ page }) => {
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
  const release = page.locator('.sp input[data-bind$=":release"]');
  await expect(release).toHaveAttribute("data-bind", /^reqs:[^:]+:release$/);
  await expect(release).not.toHaveAttribute("data-bind", /undefined/);
  await release.fill("Release di prova");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  await page.locator("[data-act=rqReset]").click();
  await expect(page.locator(`#main tr[data-k^="req-"]`, { hasText: code })).toContainText("Release di prova");

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
  await expect(page.locator("#ackBox")).toBeVisible({ timeout: 20_000 }); // il controllo parte da solo

  const cols = page.locator(".sc .sc-c");
  await expect(cols).toHaveCount(4);
  const epic = cols.nth(2).locator(".sc-b").nth(1);
  await epic.click();
  await expect(cols.nth(2).locator(".sc-b").nth(1)).toHaveClass(/sel/);

  await page.locator("#ackBox").check();
  const run = page.locator("[data-act=runCreate]");
  await run.click(); // primo clic: chiede conferma
  await expect(run).toContainText("Conferma");
  await run.click();
  await expect(page.locator("#main")).toContainText(/Verifica: \d+ di \d+ ticket con tutti i campi salvati/, { timeout: 150_000 });

  const state = await (await request.get("/__sim/state")).json();
  const byType = state.issues.reduce((m, i) => ((m[i.type] = (m[i.type] || 0) + 1), m), {});
  expect(byType.Project).toBe(1);
  expect(byType.Fase).toBeGreaterThanOrEqual(1);
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
