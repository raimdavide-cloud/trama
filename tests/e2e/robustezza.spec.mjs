// Robustezza dei dati condivisi: più schede sullo stesso progetto (scrittura condizionale, 409 e riapplicazione delle modifiche)
// e salvataggi che non arrivano al server (ritentativi con l'indicatore). I conflitti si forzano senza aspettare la
// sincronizzazione: la scheda che deve avere la base vecchia non riceve gli aggiornamenti (poll bloccato).
import { test, expect } from "@playwright/test";
import { openStudio, goToStep, openSec, toAck, runCreate, DONE, PROJECT, simState } from "./aiuti.mjs";

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
  await saved(page); // i salvataggi dell'apertura (registro delle decisioni) sono già arrivati
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

test("cambio di lingua con il server dei dati giù: la pagina si ricarica lo stesso entro pochi secondi, l'avviso del browser protegge i salvataggi in coda", async ({ page, request }) => {
  await page.route("**/items/presence/**", (r) => r.fulfill({ json: { ok: true } }));
  await openStudio(page);
  await saved(page);
  await request.post("/__sim/fault", { data: { kind: "api503", times: 1000 } });
  await page.evaluate(() => { const t = ticketList()[0]; put("tickets", t.id, (x) => ({ ...x, title: "In coda" })); });
  await expect(page.locator("#savePend")).toHaveText("1 salvataggio in attesa");
  page.on("dialog", (d) => d.accept()); // l'avviso di beforeunload: chi cambia lingua sceglie di lasciare la pagina
  await page.locator("#langBtn").click();
  await page.locator('[data-lang="en"]').click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en", { timeout: 8_000 });
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

/* ---------- Jira: lock condiviso, creazione interrotta, sincronizzazione, label, «Rigenera» ---------- */
// creazioni arrivate a Jira (simulato)
const creates = async (request) => (await simState(request)).calls.filter((c) => /^POST \S*\/issue \[/.test(c));
const serverNow = async (request) => Number((await (await request.get(`/api/projects/${PID}/items/meta/kit`)).json()).now);
const lockOnServer = async (request) => { const r = await request.get(`/api/projects/${PID}/items/meta/lock`); return r.ok() ? (await r.json()).item.data : null; };
// trattiene in Jira la prima creazione di un tipo di ticket finché il test non la lascia andare
function holdCreate(page, type) {
  let open, reached, used = false;
  const gate = new Promise((r) => (open = r)), at = new Promise((r) => (reached = r));
  page.route("**/api/jira/createJiraIssue", async (route) => { if (!used && route.request().postDataJSON().issueTypeName === type) { used = true; reached(); await gate; } return route.continue(); });
  return { at, open: () => open() };
}
async function startCreate(page) {
  await goToStep(page, "Crea su Jira");
  await toAck(page);
  await runCreate(page);
}
const finished = (page) => expect.poll(() => page.evaluate(() => !T.running && !busy.runCreate), { timeout: 60_000 }).toBe(true);
const projectType = (page) => page.evaluate(() => K().hier.projectType);
const decided = (page) => page.evaluate(() => arr("decisions").filter((d) => /Backlog iniziale creato/.test(d.text)).length);

test("lock: mentre un collega crea su Jira «Crea su Jira» è disabilitato con il suo nome; avviato prima che il poll lo mostri viene rifiutato e non crea nulla", async ({ page, request }) => {
  await openStudio(page);
  await goToStep(page, "Crea su Jira");
  await toAck(page);
  const now = await serverNow(request);
  await request.put(`/api/projects/${PID}/items/meta/lock`, { ...asLaura, data: { by: "scheda-di-laura", account: "laura-1", name: "Laura Bianchi", kind: "create", until: now + 120e6 } });
  await runCreate(page); // la scheda non ha ancora visto il lock
  await expect(page.locator("#toast")).toHaveText("Laura Bianchi sta già lavorando su Jira.");
  await finished(page);
  expect(await creates(request)).toEqual([]);
  expect((await lockOnServer(request)).by).toBe("scheda-di-laura"); // il lock del collega resta suo
  await page.evaluate(() => DB.poll());
  await expect(page.locator("[data-act=runCreate]")).toBeDisabled();
  await expect(page.locator("#main")).toContainText("Laura Bianchi sta già lavorando su Jira.");
  // scaduto: si può di nuovo
  await request.put(`/api/projects/${PID}/items/meta/lock`, { ...asLaura, data: { by: "scheda-di-laura", account: "laura-1", name: "Laura Bianchi", kind: "create", until: now - 1 } });
  await page.evaluate(() => DB.poll());
  await expect(page.locator("[data-act=runCreate]")).toBeEnabled();
});

test("lock: due schede dello stesso utente, la seconda non parte mentre la prima crea; nessun doppione in Jira", async ({ page, request, browser, baseURL }) => {
  test.setTimeout(120_000);
  await openStudio(page);
  const hold = holdCreate(page, await projectType(page));
  await startCreate(page);
  await hold.at; // la prima scheda ha il lock ed è ferma sulla prima creazione
  const b = await secondTab(browser, baseURL);
  await goToStep(b, "Crea su Jira");
  await toAck(b);
  await expect(b.locator("[data-act=runCreate]")).toBeDisabled(); // il lock arriva con i dati del progetto
  await expect(b.locator("#main")).toContainText("Stai già lavorando su Jira in un'altra scheda.");
  await b.evaluate(() => { const el = document.createElement("button"); A.runCreate(el); A.runCreate(el); }); // avviata a forza
  await expect(b.locator("#toast")).toHaveText("Stai già lavorando su Jira in un'altra scheda.");
  await finished(b);
  expect(await creates(request)).toEqual([]);
  hold.open();
  await expect(page.locator("#main")).toContainText(DONE, { timeout: 60_000 });
  const sums = (await simState(request)).issues.map((i) => i.summary);
  expect(new Set(sums).size, "nessun doppione").toBe(sums.length);
  expect(await lockOnServer(request)).toEqual({}); // rilasciato alla fine
  await b.context().close();
});

test("lock: scaduto e ripreso da un'altra scheda, la prima si ferma al rinnovo e il suo rilascio non tocca il lock dell'altra", async ({ page, request, browser, baseURL }) => {
  test.setTimeout(120_000);
  await openStudio(page);
  const type = await projectType(page);
  const holdA = holdCreate(page, type);
  await startCreate(page);
  await holdA.at;
  const mine = await lockOnServer(request);
  expect(mine.by).toBe(await page.evaluate(() => TAB_ID));
  await request.put(`/api/projects/${PID}/items/meta/lock`, { data: { ...mine, until: (await serverNow(request)) - 1 } }); // scaduto
  const b = await secondTab(browser, baseURL);
  const holdB = holdCreate(b, type);
  await startCreate(b);
  await holdB.at; // la seconda scheda ha preso il lock
  const bTab = await b.evaluate(() => TAB_ID);
  expect((await lockOnServer(request)).by).toBe(bTab);
  await page.evaluate(() => { LOCK.t = 0; }); // il prossimo controllo rinnova subito
  holdA.open();
  await finished(page);
  await expect(page.locator("#main .log")).toContainText("Hai perso il lock: creazione interrotta.");
  await expect(page.locator("#main .log")).toContainText("Creazione interrotta:");
  expect((await lockOnServer(request)).by).toBe(bTab);
  holdB.open();
  await finished(b);
  await b.context().close();
});

test("creazione: le chiavi delle epiche scritte durante la creazione restano quando un'altra scheda salva il kit", async ({ page, request, browser, baseURL }) => {
  test.setTimeout(120_000);
  await openStudio(page);
  const b = await secondTab(browser, baseURL);
  await stale(b); // la seconda scheda ha il kit di prima della creazione
  const hold = holdCreate(page, "Story");
  await startCreate(page);
  await hold.at; // epiche create, ticket non ancora
  await saved(page);
  const epics = (await simState(request)).issues.filter((i) => i.type === "Feature Epic").length;
  expect(epics).toBeGreaterThan(0);
  await goToStep(b, "Kit di progetto");
  await openSec(b, "Release (= Fase)");
  await edit(b.locator('[data-bind="meta:kit:releases.1.date"]'), "2027-07-01");
  await saved(b);
  const kit = await kitOnServer(request);
  expect(kit.releases[1].date).toBe("2027-07-01");
  expect(kit.epics.filter((e) => e.key).length).toBe(epics);
  hold.open();
  await expect(page.locator("#main")).toContainText(DONE, { timeout: 60_000 });
  await b.context().close();
});

test("creazione: esito incerto su un ticket, si ferma senza decisione «Backlog iniziale creato» né riepilogo", async ({ page, request }) => {
  test.setTimeout(120_000);
  await request.post("/__sim/fault", { data: { kind: "afterCreate500", type: "Story", times: 1 } });
  await openStudio(page);
  const before = await decided(page);
  await startCreate(page);
  await finished(page);
  await expect(page.locator("#main .log")).toContainText("esito incerto, creazione fermata.");
  await expect(page.locator("#main .log")).toContainText("Creazione interrotta:");
  expect(await page.evaluate(() => !!T.report)).toBe(false);
  expect(await decided(page)).toBe(before);
});

test("creazione: dopo «Ferma» niente collegamenti, verifica, riepilogo né decisione", async ({ page, request }) => {
  test.setTimeout(120_000);
  await openStudio(page);
  const before = await decided(page);
  const hold = holdCreate(page, "Story");
  await startCreate(page);
  await hold.at;
  await page.locator("[data-act=stopRun]").click();
  hold.open();
  await finished(page);
  await expect(page.locator("#main .log")).toContainText("Fermato su tua richiesta.");
  await expect(page.locator("#main .log")).toContainText(/Creazione interrotta: \d+ creati, ricontrolla prima di riprendere\./);
  expect(await page.evaluate(() => !!T.report)).toBe(false);
  expect(await decided(page)).toBe(before);
  expect((await simState(request)).links).toEqual([]);
});

test("creazione: un'epica con esito incerto che la ricerca non ritrova non viene creata due volte, la creazione si ferma", async ({ page, request }) => {
  test.setTimeout(120_000);
  await request.post("/__sim/fault", { data: { kind: "afterCreate500", type: "Feature Epic", times: 1 } });
  await openStudio(page);
  // la ricerca dei ticket appena creati non risponde
  await page.route("**/api/jira/searchJiraIssuesUsingJql", (r) => (/created >=/.test(r.request().postDataJSON().jql) ? r.fulfill({ json: { ok: false, code: "upstream_error", message: "ricerca non disponibile" } }) : r.continue()));
  await startCreate(page);
  await finished(page);
  const st = await simState(request);
  const epics = st.issues.filter((i) => i.type === "Feature Epic").map((i) => i.summary);
  expect(epics).toHaveLength(1);
  expect(st.issues.filter((i) => i.type === "Story")).toHaveLength(0);
  await expect(page.locator("#main .log")).toContainText(`«${epics[0]}»: esito incerto e non ritrovato in Jira`);
  await expect(page.locator("#main .log")).toContainText("Creazione interrotta:");
});

test("sincronizzazione: una chiave che Jira non mostra resta al ticket, compare tra i «Non trovati»; torna in bozza solo dopo la conferma", async ({ page, request }) => {
  test.setTimeout(120_000);
  await openStudio(page);
  await startCreate(page);
  await expect(page.locator("#main")).toContainText(DONE, { timeout: 60_000 });
  const key = (await simState(request)).issues.find((i) => i.type === "Story").key;
  const id = await page.evaluate((key) => ticketList().find((t) => t.key === key).id, key);
  await request.post("/__sim/fault", { data: { kind: "hidden", type: key, times: 1 } });
  await openSec(page, "Sincronizzazione con Jira");
  const sec = page.locator('#main details.sec[data-sec="create:sincronizzazione-con-jira"]');
  await sec.getByRole("button", { name: "Sincronizza e verifica" }).click();
  await expect(sec).toContainText("Non trovati in Jira: eliminati, oppure non visibili con i tuoi permessi", { timeout: 30_000 });
  await expect(sec).toContainText(key);
  await expect(sec).toContainText("(404)"); // lo status di Jira, non quello della risposta di Trama
  await saved(page);
  expect(await page.evaluate((id) => [S.tickets[id].state, S.tickets[id].key], id)).toEqual(["created", key]);
  const back = sec.locator("[data-act=syncDraft]");
  await back.click();
  await expect(back).toHaveText("Conferma: riporta in bozza");
  await back.click();
  await expect.poll(() => page.evaluate((id) => [S.tickets[id].state, S.tickets[id].key || ""], id)).toEqual(["draft", ""]);
});

test("label con spazi: errore bloccante, la creazione non chiama Jira; il server la rifiuta anche se chiamato direttamente", async ({ page, request }) => {
  await openStudio(page);
  await page.evaluate(() => ticketList().forEach((t) => put("tickets", t.id, (x) => ({ ...x, labels: ["Etichetta lunga"] }), { force: true })));
  await saved(page);
  await goToStep(page, "Backlog");
  const t = await page.evaluate(() => ticketList()[0].id);
  await page.locator(`#main tr[data-id="${t}"]`).click();
  await expect(page.locator(".sp .issues")).toContainText('La label "Etichetta lunga" contiene spazi: Jira non la accetta');
  await goToStep(page, "Crea su Jira");
  await page.waitForFunction(() => !!T.pre, null, { timeout: 20_000 });
  await page.evaluate(() => { const el = document.createElement("button"); A.runCreate(el); A.runCreate(el); });
  await finished(page);
  expect(await creates(request)).toEqual([]);
  expect(await page.evaluate(() => ticketList().every((x) => x.state === "draft"))).toBe(true);
  const direct = await page.evaluate(() => jira("createJiraIssue", { cloudId: P().cloudId, projectKey: P().key, issueTypeName: "Story", summary: "Con label sbagliata", contentFormat: "markdown", description: "", additional_fields: { labels: ["Etichetta lunga"] } }).then(() => "creato", (e) => e.code));
  expect(direct).toBe("tool_error");
});

test("«Rigenera» con il ponte spento lascia le bozze com'erano", async ({ page, request }) => {
  await openStudio(page);
  const code = await page.evaluate(() => reqList().find((r) => ticketList().some((t) => t.req === r.code)).code);
  const before = await page.evaluate((code) => ticketList().filter((t) => t.req === code).map((t) => t.id).sort(), code);
  await page.evaluate((code) => { SAMPLE = null; const el = document.createElement("button"); el.dataset.code = code; A.regenReq(el); A.regenReq(el); }, code);
  await expect.poll(() => page.evaluate(() => !busy.regenReq)).toBe(true);
  await saved(page);
  expect(await page.evaluate((code) => ticketList().filter((t) => t.req === code).map((t) => t.id).sort(), code)).toEqual(before);
  const items = (await (await request.get(`/api/projects/${PID}`)).json()).items;
  expect(items.filter((i) => i.col === "tickets" && before.includes(i.id))).toHaveLength(before.length);
});

test("creazione: «Ferma» durante i collegamenti, niente verifica, riepilogo né decisione", async ({ page, request }) => {
  test.setTimeout(120_000);
  await openStudio(page);
  const before = await decided(page);
  let open, reached, used = false;
  const gate = new Promise((r) => (open = r)), at = new Promise((r) => (reached = r));
  await page.route("**/api/jira/createIssueLink", async (route) => { if (!used) { used = true; reached(); await gate; } return route.continue(); });
  await startCreate(page);
  await at; // tutti i ticket creati, primo collegamento in corso
  await page.locator("[data-act=stopRun]").click();
  open();
  await finished(page);
  await expect(page.locator("#main .log")).toContainText(/Creazione interrotta: \d+ creati, ricontrolla prima di riprendere\./);
  expect(await page.evaluate(() => !!T.report)).toBe(false);
  expect(await decided(page)).toBe(before);
  expect((await simState(request)).links.length).toBeLessThanOrEqual(1);
});

test("«Rigenera» non riuscita: una bozza che un collega ha creato in Jira nel frattempo resta creata, con la sua chiave", async ({ page, request }) => {
  await openStudio(page);
  const code = await page.evaluate(() => reqList().find((r) => ticketList().some((t) => t.req === r.code)).code);
  const t = await page.evaluate((code) => { const t = ticketList().find((x) => x.req === code); return { id: t.id, data: S.tickets[t.id] }; }, code);
  await page.evaluate((s) => jira("createJiraIssue", { cloudId: P().cloudId, projectKey: P().key, issueTypeName: "Story", summary: s, contentFormat: "markdown", description: "", additional_fields: {} }), t.data.title);
  const key = (await simState(request)).issues.at(-1).key;
  await page.evaluate(({ code, t, pid, key }) => {
    SAMPLE = { ok: true };
    // mentre Claude «pensa», un collega crea in Jira uno dei ticket appena tolti; poi la generazione non riesce
    window.ask = async () => { await BS.writesDone(); await fetch(`/api/projects/${pid}/items/tickets/${t.id}`, { method: "PUT", headers: { "content-type": "application/json", "x-sim-by": "laura-1" }, body: JSON.stringify({ ...t.data, state: "created", key }) }); throw { code: "rate_limited" }; };
    const el = document.createElement("button"); el.dataset.code = code; A.regenReq(el); A.regenReq(el);
  }, { code, t, pid: PID, key });
  await expect.poll(() => page.evaluate(() => !busy.regenReq)).toBe(true);
  await saved(page);
  const after = (await (await request.get(`/api/projects/${PID}/items/tickets/${t.id}`)).json()).item.data;
  expect([after.state, after.key]).toEqual(["created", key]);
});

test("kit: con due epiche dallo stesso nome la modifica va su quella della riga, anche se un collega ha eliminato una riga sopra", async ({ page, browser, baseURL }) => {
  await openStudio(page);
  await goToStep(page, "Kit di progetto");
  await openSec(page, "Epiche");
  await page.locator("[data-act=addEpic]").click();
  await page.locator("[data-act=addEpic]").click();
  await saved(page);
  const n = await page.evaluate(() => K().epics.length);
  await edit(page.locator(`[data-bind="meta:kit:epics.${n - 1}.name"]`), "Seconda");
  await saved(page);
  expect((await kitOnServer(serverOf(page))).epics.slice(-2).map((e) => e.name)).toEqual(["Nuova epica", "Seconda"]);
  await page.evaluate((i) => editKit((k) => { k.epics[i].name = "Nuova epica"; }), n - 1); // di nuovo due righe uguali
  await saved(page);
  const b = await secondTab(browser, baseURL);
  await stale(page);
  await goToStep(b, "Kit di progetto");
  await openSec(b, "Epiche");
  await b.locator("[data-act=delEpic]").first().click(); // il collega elimina la prima epica
  await saved(b);
  await edit(page.locator(`[data-bind="meta:kit:epics.${n - 1}.name"]`), "Seconda"); // per questa scheda è ancora la riga n-1
  await saved(page);
  const names = (await kitOnServer(serverOf(page))).epics.map((e) => e.name);
  expect(names).toHaveLength(n - 1);
  expect(names.slice(-2)).toEqual(["Nuova epica", "Seconda"]);
  await b.context().close();
});

test("creazione: se un'altra scheda ha già salvato la chiave del ticket, resta la sua e il log segnala il doppione", async ({ page, request }) => {
  test.setTimeout(120_000);
  await openStudio(page);
  let open, reached, summary = "";
  const gate = new Promise((r) => (open = r)), at = new Promise((r) => (reached = r));
  await page.route("**/api/jira/createJiraIssue", async (route) => { const b = route.request().postDataJSON(); if (!summary && b.issueTypeName === "Story") { summary = b.summary; reached(); await gate; } return route.continue(); });
  await startCreate(page);
  await at; // la richiesta è ferma prima di arrivare a Jira
  const id = await page.evaluate((s) => ticketList().find((t) => fullTitle(t) === s).id, summary);
  const data = (await (await request.get(`/api/projects/${PID}/items/tickets/${id}`)).json()).item.data;
  await page.evaluate(() => jira("createJiraIssue", { cloudId: P().cloudId, projectKey: P().key, issueTypeName: "Story", summary: "Creato dall'altra scheda", contentFormat: "markdown", description: "", additional_fields: {} }));
  const theirs = (await simState(request)).issues.at(-1).key;
  await request.put(`/api/projects/${PID}/items/tickets/${id}`, { ...asLaura, data: { ...data, state: "created", key: theirs } });
  open();
  await expect(page.locator("#main .log")).toContainText(`creato in Jira, ma il ticket era già ${theirs}: doppione da eliminare a mano in Jira.`, { timeout: 30_000 });
  await finished(page);
  const after = (await (await request.get(`/api/projects/${PID}/items/tickets/${id}`)).json()).item.data;
  expect([after.state, after.key]).toEqual(["created", theirs]);
});
