// Robustezza dei dati condivisi: più schede sullo stesso progetto (scrittura condizionale, 409 e riapplicazione delle modifiche)
// e salvataggi che non arrivano al server (ritentativi con l'indicatore). I conflitti si forzano senza aspettare la
// sincronizzazione: la scheda che deve avere la base vecchia non riceve gli aggiornamenti (poll bloccato).
import { test, expect } from "@playwright/test";
import { openStudio, goToStep, openSec, PROJECT, simState } from "./aiuti.mjs";

test.beforeEach(async ({ request }) => {
  await request.get("/__sim/reset");
});

const PID = PROJECT.split("p=")[1];
const asLaura = { headers: { "x-sim-by": "laura-1" } };
const serverOf = (page) => page.context().request;
const kitOnServer = async (request) => (await (await request.get(`/api/projects/${PID}/items/meta/kit`)).json()).item.data;
// la scheda non vede più i salvataggi degli altri finché non scrive: la sua versione resta quella di prima
const stale = (page) => page.route((u) => /^\/api\/projects\/[^/]+$/.test(u.pathname) && u.searchParams.has("since"), (r) => r.abort());
// risposte 409 alle scritture della scheda
function conflicts(page) {
  const seen = [];
  page.on("response", (r) => { if (r.status() === 409 && ["PUT", "DELETE"].includes(r.request().method())) seen.push(new URL(r.url()).pathname.split("/items/")[1]); });
  return seen;
}
// una seconda scheda sullo stesso progetto (un collega, o lo stesso utente in un'altra finestra)
async function secondTab(browser, baseURL) {
  const ctx = await browser.newContext({ baseURL, locale: "it-IT", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await openStudio(page);
  return page;
}
const saved = (page) => page.evaluate(() => BS.writesDone());
async function edit(field, value) {
  await field.fill(value);
  await field.blur(); // il campo si salva quando lo lasci
}

test("kit: due schede cambiano campi diversi entro pochi secondi e restano entrambe le modifiche; quella con la versione vecchia riceve 409 e riapplica la sua", async ({ page, browser, baseURL }) => {
  await openStudio(page);
  const b = await secondTab(browser, baseURL);
  await stale(page);
  const seen = conflicts(page);
  for (const p of [page, b]) { await goToStep(p, "Kit di progetto"); await openSec(p, "Release (= Fase)"); }
  await edit(b.locator('[data-bind="meta:kit:releases.1.date"]'), "2027-07-01");
  await saved(b);
  await edit(page.locator('[data-bind="meta:kit:releases.2.date"]'), "2027-09-15");
  await saved(page);
  expect(seen).toEqual(["meta/kit"]);
  const kit = await kitOnServer(serverOf(page));
  expect(kit.releases.map((r) => r.date)).toEqual(["2027-03-11", "2027-07-01", "2027-09-15"]);
  // la scheda che ha riapplicato vede anche la modifica dell'altra
  expect(await page.evaluate(() => K().releases.map((r) => r.date))).toEqual(["2027-03-11", "2027-07-01", "2027-09-15"]);
  await b.context().close();
});

test("kit: un collega elimina una release mentre ne rinomino un'altra; la rinomina va su quella giusta e non nascono elementi spuri", async ({ page, browser, baseURL }) => {
  await openStudio(page);
  const b = await secondTab(browser, baseURL);
  await stale(page);
  const seen = conflicts(page);
  for (const p of [page, b]) { await goToStep(p, "Kit di progetto"); await openSec(p, "Release (= Fase)"); }
  const names = await page.evaluate(() => K().releases.map((r) => r.name));
  expect(names).toHaveLength(3);
  await b.locator("[data-act=delRelease]").first().click(); // via la prima release
  await saved(b);
  expect((await kitOnServer(serverOf(page))).releases.map((r) => r.name)).toEqual(names.slice(1));
  await edit(page.locator('[data-bind="meta:kit:releases.1.name"]'), `${names[1]} bis`); // la seconda, per chi non ha visto l'eliminazione
  await saved(page);
  expect(seen).toContain("meta/kit");
  const kit = await kitOnServer(serverOf(page));
  expect(kit.releases.map((r) => r.name)).toEqual([`${names[1]} bis`, names[2]]);
  expect(kit.releases.every((r) => r.label && "date" in r)).toBe(true); // niente release fatte solo del nome
  expect(kit.epics.filter((e) => e.release === names[1])).toHaveLength(0); // le epiche seguono la rinomina
  expect(kit.epics.filter((e) => e.release === `${names[1]} bis`).length).toBeGreaterThan(0);
  await b.context().close();
});

test("kit: un'epica eliminata da un collega mentre la rinomino non torna: la modifica si annulla e lo dice", async ({ page, browser, baseURL }) => {
  await openStudio(page);
  const b = await secondTab(browser, baseURL);
  await stale(page);
  for (const p of [page, b]) { await goToStep(p, "Kit di progetto"); await openSec(p, "Epiche"); }
  const first = await page.evaluate(() => K().epics[0].name);
  await b.locator("[data-act=delEpic]").first().click();
  await saved(b);
  await edit(page.locator('[data-bind="meta:kit:epics.0.name"]'), `${first} bis`);
  await saved(page);
  await expect(page.locator("#toast")).toHaveText("L'elemento è stato modificato o eliminato da un collega.");
  const kit = await kitOnServer(serverOf(page));
  expect(kit.epics.map((e) => e.name)).not.toContain(first);
  expect(kit.epics.map((e) => e.name)).not.toContain(`${first} bis`);
  expect(await page.evaluate(() => K().epics.map((e) => e.name))).toEqual(kit.epics.map((e) => e.name)); // la scheda mostra la versione del collega
  await b.context().close();
});

test("ticket: la label cambiata da una copia vecchia (ancora in bozza) non riporta in bozza il ticket creato in Jira nel frattempo", async ({ page, request }) => {
  await openStudio(page);
  await stale(page);
  const seen = conflicts(page);
  await goToStep(page, "Backlog");
  const t = await page.evaluate(() => { const t = ticketList().find((x) => x.state === "draft"); return { id: t.id, data: S.tickets[t.id] }; });
  await page.locator(`#main tr[data-id="${t.id}"]`).click();
  const labels = page.locator('.sp input[data-bind$=":labels"]');
  await expect(labels).toBeVisible();
  // un'altra scheda crea il ticket in Jira e salva la chiave
  await page.evaluate(() => jira("createJiraIssue", { cloudId: P().cloudId, projectKey: P().key, issueTypeName: "Story", summary: "Creato dall'altra scheda", contentFormat: "markdown", description: "", additional_fields: {} }));
  const key = (await simState(request)).issues.at(-1).key;
  expect(key).toMatch(/^[A-Z][A-Z0-9]*-\d+$/);
  await request.put(`/api/projects/${PID}/items/tickets/${t.id}`, { ...asLaura, data: { ...t.data, state: "created", key, err: "" } });
  expect(await page.evaluate((id) => S.tickets[id].state, t.id)).toBe("draft"); // questa scheda non lo sa ancora
  await edit(labels, "Android, Manual_Test");
  await saved(page);
  expect(seen).toEqual([`tickets/${t.id}`]);
  const after = (await (await request.get(`/api/projects/${PID}/items/tickets/${t.id}`)).json()).item.data;
  expect(after.state).toBe("created");
  expect(after.key).toBe(key);
  expect(after.labels).toEqual(["Android", "Manual_Test"]);
  expect(await page.evaluate((id) => [S.tickets[id].state, S.tickets[id].key], t.id)).toEqual(["created", key]);
});

test("kit: «Annulla» dopo l'import rimette il kit di prima ma tiene le chiavi Jira scritte nel frattempo", async ({ page, request }) => {
  await openStudio(page);
  await goToStep(page, "Kit di progetto");
  const before = await page.evaluate(() => ({ releases: K().releases.map((r) => r.name), epics: K().epics.map((e) => e.name) }));
  await page.evaluate(async () => { T.ki = { src: "tpl:iot", parts: { rules: false, releases: true, epics: true }, over: false }; const el = document.createElement("button"); A.kitImportRun(el); A.kitImportRun(el); });
  await expect.poll(() => page.evaluate(() => K().epics.length)).toBeGreaterThan(before.epics.length);
  // intanto la creazione su Jira salva la chiave di un'epica
  await page.evaluate(() => jira("createJiraIssue", { cloudId: P().cloudId, projectKey: P().key, issueTypeName: "Feature Epic", summary: "Epica creata", contentFormat: "markdown", description: "", additional_fields: {} }));
  const key = (await simState(request)).issues.at(-1).key;
  await page.evaluate((key) => editKit((k) => { k.epics[0].key = key; }), key);
  await page.locator("#toast .toast-undo").click();
  await saved(page);
  const kit = await kitOnServer(request);
  expect(kit.releases.map((r) => r.name)).toEqual(before.releases);
  expect(kit.epics.map((e) => e.name)).toEqual(before.epics);
  expect(kit.epics[0].key).toBe(key);
});

test("server dei dati irraggiungibile: i salvataggi restano in coda, l'indicatore li conta, arrivano dopo il ripristino nell'ordine giusto", async ({ page, request }) => {
  await page.route("**/items/presence/**", (r) => r.fulfill({ json: { ok: true } })); // i battiti di presenza non consumano il guasto
  await openStudio(page);
  const ids = await page.evaluate(() => ({ req: Object.keys(S.reqs)[0], ticket: ticketList()[0].id }));
  await request.post("/__sim/fault", { data: { kind: "api503", times: 2 } });
  // senza limite la promessa dice «accettato» (in coda), con {wait} dice se è arrivato davvero
  const res = await page.evaluate(async ({ req, ticket }) => {
    const a = put("reqs", req, { ...S.reqs[req], title: "Primo titolo" });
    const b = put("tickets", ticket, (t) => ({ ...t, title: "Uno" }));
    const c = put("tickets", ticket, (t) => ({ ...t, title: "Due" }), { wait: 1000 });
    return [await a, await b, await c];
  }, ids);
  expect(res).toEqual([true, true, false]);
  const pend = page.locator("#savePend");
  await expect(pend).toHaveText("3 salvataggi in attesa");
  await expect(pend).toBeHidden({ timeout: 20_000 }); // 2 + 5 secondi di attesa, poi passa
  const items = (await (await request.get(`/api/projects/${PID}`)).json()).items;
  expect(items.find((i) => i.col === "reqs" && i.id === ids.req).data.title).toBe("Primo titolo");
  expect(items.find((i) => i.col === "tickets" && i.id === ids.ticket).data.title).toBe("Due");
  expect(await page.evaluate((id) => S.tickets[id].title, ids.ticket)).toBe("Due");
});

test("kit: una modifica ancora in viaggio non torna indietro quando arriva un aggiornamento di un altro documento", async ({ page, request }) => {
  await openStudio(page);
  await goToStep(page, "Kit di progetto");
  await openSec(page, "Release (= Fase)");
  await page.route(`**/api/projects/${PID}/items/meta/kit`, async (r) => { if (r.request().method() === "PUT") await new Promise((res) => setTimeout(res, 1500)); return r.continue(); }); // server lento
  expect(await page.evaluate(() => S.runlog)).toBeUndefined();
  await edit(page.locator('[data-bind="meta:kit:releases.1.date"]'), "2027-08-20");
  await request.put(`/api/projects/${PID}/items/meta/runlog`, { ...asLaura, data: { at: Date.now(), lines: ["log di un collega"] } });
  await page.evaluate(() => DB.poll());
  expect(await page.evaluate(() => [!!S.runlog, K().releases[1].date])).toEqual([true, "2027-08-20"]); // il log è arrivato, la data resta
  await saved(page);
  expect((await kitOnServer(request)).releases[1].date).toBe("2027-08-20");
});

test("conflitto che non si risolve: dopo 3 tentativi la scheda lo dice e mostra la versione del collega", async ({ page, request }) => {
  await openStudio(page);
  await goToStep(page, "Kit di progetto");
  await openSec(page, "Release (= Fase)");
  const kit = await kitOnServer(request);
  const date = await page.evaluate(() => K().releases[1].date);
  await request.put(`/api/projects/${PID}/items/meta/kit`, { ...asLaura, data: { ...kit, releases: kit.releases.map((r, i) => (i ? r : { ...r, label: "ReleaseCollega" })) } });
  let puts = 0; // il server rifiuta sempre: c'è sempre qualcuno che ha salvato prima
  await page.route(`**/api/projects/${PID}/items/meta/kit`, (r) => { if (r.request().method() !== "PUT") return r.continue(); puts++; return r.fulfill({ status: 409, json: { ok: false, code: "conflict", message: "conflitto", at: "1" } }); });
  await edit(page.locator('[data-bind="meta:kit:releases.1.date"]'), "2027-12-01");
  await saved(page);
  expect(puts).toBe(4); // la prima scrittura e 3 riapplicazioni
  await expect(page.locator("#toast")).toHaveText("Un collega ha appena modificato questa parte: ricaricata la sua versione, rifai la modifica.");
  expect(await page.evaluate(() => [K().releases[0].label, K().releases[1].date])).toEqual(["ReleaseCollega", date]);
  await expect(page.locator('[data-bind="meta:kit:releases.0.label"]')).toHaveValue("ReleaseCollega");
});

test("kit: «Aggiungi release» riapplicata dopo un 409 aggiunge una sola release, in pagina e sul server, anche dopo la sincronizzazione", async ({ page, browser, baseURL }) => {
  await openStudio(page);
  const b = await secondTab(browser, baseURL);
  await stale(page);
  const seen = conflicts(page);
  for (const p of [page, b]) { await goToStep(p, "Kit di progetto"); await openSec(p, "Release (= Fase)"); }
  await b.locator("[data-act=addRelease]").click();
  await saved(b);
  await page.locator("[data-act=addRelease]").click();
  await saved(page);
  expect(seen).toEqual(["meta/kit"]);
  const server = (await kitOnServer(serverOf(page))).releases.map((r) => r.name);
  expect(server).toHaveLength(5);
  expect(new Set(server).size).toBe(5);
  expect(await page.evaluate(() => K().releases.map((r) => r.name))).toEqual(server);
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.evaluate(() => DB.poll());
  await page.evaluate(() => editKit((k) => { k.glossary = "dopo"; })); // la scrittura successiva non salva doppioni
  await saved(page);
  expect((await kitOnServer(serverOf(page))).releases.map((r) => r.name)).toEqual(server);
  await b.context().close();
});

test("kit: rinomino una release che un collega ha appena eliminato; requisiti e ticket non cambiano", async ({ page, request, browser, baseURL }) => {
  await openStudio(page);
  const b = await secondTab(browser, baseURL);
  await stale(page);
  for (const p of [page, b]) { await goToStep(p, "Kit di progetto"); await openSec(p, "Release (= Fase)"); }
  const name = await page.evaluate(() => K().releases[1].name);
  const count = async () => (await (await request.get(`/api/projects/${PID}`)).json()).items.filter((i) => (i.col === "reqs" || i.col === "tickets") && !i.deleted && i.data.release === name).length;
  const before = await count();
  expect(before).toBeGreaterThan(0);
  await b.locator("[data-act=delRelease]").nth(1).click();
  await saved(b);
  await edit(page.locator('[data-bind="meta:kit:releases.1.name"]'), `${name} bis`);
  await saved(page);
  await expect(page.locator("#toast")).toHaveText("L'elemento è stato modificato o eliminato da un collega.");
  expect(await count()).toBe(before);
  const items = (await (await request.get(`/api/projects/${PID}`)).json()).items;
  expect(items.filter((i) => i.data?.release === `${name} bis`)).toHaveLength(0);
  expect(await page.evaluate((n) => ticketList().filter((t) => t.release === n).length + reqList().filter((r) => r.release === n).length, `${name} bis`)).toBe(0);
  await b.context().close();
});
