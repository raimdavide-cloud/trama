// Dopo la creazione: le modifiche fatte in Trama si portano in Jira con un controllo prima (cosa è cambiato in Jira nel frattempo)
// e una conferma; le label aggiunte a mano in Jira restano; i collegamenti mancanti si creano nello stesso giro.
import { test, expect } from "@playwright/test";
import { openStudio, goToStep, toAck, runCreate, DONE, simState, openSec } from "./aiuti.mjs";

test.beforeEach(async ({ request }) => {
  await request.get("/__sim/reset");
});

test("ticket creato e poi modificato in Trama: «da aggiornare», controllo con avviso, conferma, Jira aggiornato", async ({ page, request }) => {
  test.setTimeout(240_000);
  await openStudio(page);
  await goToStep(page, "Crea su Jira");
  await toAck(page);
  await runCreate(page);
  await expect(page.locator("#main")).toContainText(DONE, { timeout: 200_000 });
  // due ticket creati: uno cambiato solo in Trama, l'altro cambiato anche in Jira da qualcun altro
  const [a, b] = await page.evaluate(() => ticketList().filter((t) => t.state === "created" && t.key).slice(0, 2).map((t) => ({ id: t.id, key: t.key })));
  await page.evaluate(async ({ a, b }) => {
    put("tickets", a.id, { ...S.tickets[a.id], title: "Changed in Trama", labels: [...(S.tickets[a.id].labels || []), "Manual_Test"] });
    put("tickets", b.id, { ...S.tickets[b.id], desc: S.tickets[b.id].desc + "\n* One more criterion." });
    await jira("editJiraIssue", { cloudId: P().cloudId, issueKey: a.key, summary: "Renamed in Jira", labels: ["MVP", "FromJira"] });
  }, { a, b });
  // nel Backlog il ticket risulta «da aggiornare»
  await goToStep(page, "Backlog");
  await expect(page.locator(`#main tr[data-id="${a.id}"] .dt-st`)).toContainText("da aggiornare");
  await goToStep(page, "Crea su Jira");
  await openSec(page, "Sincronizzazione con Jira");
  const sec = page.locator('#main details.sec[data-sec="create:sincronizzazione-con-jira"]');
  await expect(sec.locator(".push-box")).toContainText("2 ticket modificati in Trama dopo la creazione");
  await sec.getByRole("button", { name: "Controlla e aggiorna Jira" }).click();
  await expect(sec).toContainText("2 ticket da aggiornare in Jira");
  await expect(sec).toContainText("in Jira il titolo era stato cambiato in «Renamed in Jira»: verrà sostituito");
  await sec.getByRole("button", { name: "Conferma: aggiorna Jira" }).click();
  await expect(page.locator("#toast")).toHaveText("2 ticket aggiornati in Jira.", { timeout: 60_000 });
  const st = await simState(request);
  const ja = st.issues.find((i) => i.key === a.key);
  expect(ja.summary).toMatch(/Changed in Trama$/);
  expect(ja.labels).toEqual(expect.arrayContaining(["Manual_Test", "FromJira"]));
  expect(await page.evaluate(({ a, b }) => [dirtyOf(S.tickets[a.id]).length, dirtyOf(S.tickets[b.id]).length], { a, b })).toEqual([0, 0]);
  await expect(sec.locator(".push-box")).toContainText("Nessuna modifica: Jira è allineato a Trama.");
  // il pulsante dei soli collegamenti non c'è più: i collegamenti si creano con «Aggiorna Jira»
  await expect(page.locator("[data-act=runLinks]")).toHaveCount(0);
});

test("un solo ticket dal suo pannello: «Aggiorna in Jira» porta solo quel ticket", async ({ page, request }) => {
  test.setTimeout(240_000);
  await openStudio(page);
  await goToStep(page, "Crea su Jira");
  await toAck(page);
  await runCreate(page);
  await expect(page.locator("#main")).toContainText(DONE, { timeout: 200_000 });
  const t = await page.evaluate(() => { const t = ticketList().find((x) => x.state === "created" && x.key); put("tickets", t.id, { ...S.tickets[t.id], title: "Only this one" }); return { id: t.id, key: t.key, ref: t.ref }; });
  await goToStep(page, "Backlog");
  await page.locator(`#main tr[data-id="${t.id}"]`).click();
  const sp = page.locator(".sp");
  await expect(sp.locator(".msg.warn")).toContainText("Modificato qui dopo la creazione: titolo.");
  await sp.getByRole("button", { name: "Aggiorna in Jira" }).click();
  await expect(sp).toContainText("1 ticket da aggiornare in Jira");
  await sp.getByRole("button", { name: "Conferma: aggiorna Jira" }).click();
  await expect(page.locator("#toast")).toHaveText("1 ticket aggiornato in Jira.", { timeout: 60_000 });
  const st = await simState(request);
  expect(st.issues.find((i) => i.key === t.key).summary).toMatch(/Only this one$/);
  await expect(sp.locator(".msg.info")).toContainText("Se lo modifichi qui, Trama ti propone di aggiornarlo anche in Jira.");
});
