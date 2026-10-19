// Operazioni Jira esposte allo studio, contro il Jira finto del simulatore (nessuna chiamata vera).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");
const { sim } = await import("../sim/fake-jira.mjs");
const { ops, mdToWiki } = await import("../../server/lib/jira-ops.mjs");
const { seal } = await import("../../server/lib/core.mjs");
const { RETRY, retryAfterMs } = await import("../../server/lib/atlassian.mjs");

const user = { account_id: "u1", access_token: await seal("token-finto"), expires_at: new Date(Date.now() + 3600e3).toISOString(), sites: [{ id: sim.cloudId }] };
const cloudId = sim.cloudId;
const types = [{ id: "1", name: "Project", level: 3 }, { id: "2", name: "Fase", level: 2 }, { id: "3", name: "Feature Epic", level: 1 }, { id: "4", name: "Story", level: 0 }];

// attese finte: si registrano invece di aspettare davvero
let waits = [];
RETRY.sleep = async (ms) => { waits.push(ms); };
RETRY.random = () => 0.5;

beforeEach(() => { sim.reset(); sim.types = types; sim.components = ["Web"]; sim.versions = []; sim.links = []; waits = []; });

const create = (o) => ops.createJiraIssue(user, { cloudId, projectKey: "ORTO", issueTypeName: "Story", summary: "Ticket", ...o });

test("il markdown dei modelli diventa wiki markup di Jira", () => {
  assert.equal(mdToWiki("## Titolo"), "h2. Titolo");
  assert.equal(mdToWiki("- uno\n  - due"), "* uno\n** due");
  assert.equal(mdToWiki("1. primo\n2) secondo"), "# primo\n# secondo");
  assert.equal(mdToWiki("**forte** e `codice`"), "*forte* e {{codice}}");
  assert.equal(mdToWiki("[guida](https://esempio.it/x)"), "[guida|https://esempio.it/x]");
  assert.equal(mdToWiki(null), "");
});

test("la creazione passa solo i campi ammessi e taglia il titolo a 255 caratteri", async () => {
  const r = await create({ summary: "x".repeat(300), description: "## Contesto", additional_fields: { labels: ["MVP"], components: [{ name: "Web" }], fixVersions: [{ name: "1.0" }], reporter: { id: "x" } } });
  const issue = sim.issues.get(r.key);
  assert.equal(issue.summary.length, 255);
  assert.equal(issue.description, "h2. Contesto");
  assert.deepEqual(issue.fields.labels, ["MVP"]);
  assert.equal(issue.fields.fixVersions, undefined, "fixVersion non è più un campo ammesso");
  assert.equal(issue.fields.reporter, undefined);
});

test("Jira rifiuta un padre del livello sbagliato: l'errore arriva come errore dello strumento", async () => {
  const story = await create({ summary: "A" });
  const other = await create({ summary: "B" });
  await assert.rejects(ops.setIssueParent(user, { cloudId, issueKey: other.key, parentKey: story.key }), (e) => e.code === "tool_error" && /livello/.test(e.message));
  await assert.rejects(create({ additional_fields: { parent: { key: "ORTO-9999" } } }), (e) => e.code === "tool_error");
});

test("chiavi e label non valide sono rifiutate prima di chiamare Jira", async () => {
  const calls = sim.calls.length;
  await assert.rejects(ops.getJiraIssue(user, { cloudId, issueIdOrKey: "ORTO-1; DROP" }), (e) => e.code === "tool_error");
  await assert.rejects(ops.setIssueParent(user, { cloudId, issueKey: "../x", parentKey: "ORTO-1" }), (e) => e.code === "tool_error");
  await assert.rejects(ops.setReleaseFields(user, { cloudId, issueKey: "ORTO-1", labels: ["con spazio"] }), (e) => e.code === "tool_error");
  assert.equal(sim.calls.length, calls, "nessuna chiamata partita");
});

test("le label della release si deduplicano e sostituiscono quelle vecchie", async () => {
  const t = await create({ additional_fields: { labels: ["Release1"] } });
  await ops.setReleaseFields(user, { cloudId, issueKey: t.key, labels: ["Release2", " Release2 ", "MVP"] });
  assert.deepEqual(sim.issues.get(t.key).fields.labels, ["Release2", "MVP"]);
});

test("un errore 500 di Jira è segnalato come temporaneo e si può riprovare", async () => {
  sim.faults.before500.Story = 1;
  await assert.rejects(create({ summary: "Prima" }), (e) => e.code === "server_unavailable" && e.retryable === true);
  const ok = await create({ summary: "Poi" });
  assert.match(ok.key, /^ORTO-\d+$/);
});

test("senza token valido e senza rinnovo serve un nuovo accesso", async () => {
  const scaduto = { ...user, expires_at: new Date(Date.now() - 1000).toISOString(), refresh_token: null };
  await assert.rejects(ops.getIssueLinkTypes(scaduto, { cloudId }), (e) => e.code === "needs_reauth");
});

test("ricerca JQL, campi letti e collegamenti", async () => {
  const a = await create({ summary: "Diario colturale" }), b = await create({ summary: "Meteo" });
  const r = await ops.searchJiraIssuesUsingJql(user, { cloudId, jql: 'project = ORTO AND summary ~ "diario"', maxResults: 500 });
  assert.deepEqual(r.issues.map((i) => i.key), [a.key]);
  const one = await ops.getJiraIssue(user, { cloudId, issueIdOrKey: a.key, fields: ["summary", "bad field!"] });
  assert.equal(one.fields.summary, "Diario colturale");
  await ops.createIssueLink(user, { cloudId, type: "3. Blocking", inwardIssue: a.key, outwardIssue: b.key });
  assert.deepEqual(sim.links, [{ type: "3. Blocking", from: a.key, to: b.key }]);
});

/* ---------- limiti di Jira: 429 e 5xx ---------- */
const count = (re) => sim.calls.filter((c) => re.test(c)).length;
const search = () => ops.searchJiraIssuesUsingJql(user, { cloudId, jql: "project = ORTO" });

test("una lettura con 429 e Retry-After aspetta quanto chiede Jira e poi riesce", async () => {
  sim.faults.rate429.GET = 1; sim.retryAfter = "2";
  const r = await ops.getIssueLinkTypes(user, { cloudId });
  assert.ok(r.issueLinkTypes.length);
  assert.deepEqual(waits, [2000]);
  assert.equal(count(/^GET \/rest\/api\/3\/issueLinkType$/), 2);
});

test("una ricerca JQL senza Retry-After riprova con attesa esponenziale e margine casuale", async () => {
  sim.faults.down503.POST = 2; sim.retryAfter = null;
  const r = await search();
  assert.deepEqual(r.issues, []);
  assert.deepEqual(waits, [500 + 250, 1000 + 250], "base 500 ms raddoppiata a ogni tentativo, più un margine fino a 500 ms");
  assert.equal(count(/^POST \/rest\/api\/3\/search\/jql$/), 3);
});

test("al massimo 3 tentativi: poi l'errore torna come temporaneo", async () => {
  sim.faults.rate429["*"] = 5; sim.retryAfter = "1";
  await assert.rejects(search(), (e) => e.code === "server_unavailable" && e.retryable === true && e.attempts === 3 && e.retryAfter === 1);
  assert.equal(count(/search\/jql/), 3);
  assert.deepEqual(waits, [1000, 1000]);
});

test("le creazioni non si riprovano mai: né i ticket né i collegamenti", async () => {
  const [a, b] = [await create({ summary: "A" }), await create({ summary: "B" })];
  sim.faults.rate429.POST = 1;
  await assert.rejects(create({ summary: "Doppione?" }), (e) => e.code === "server_unavailable" && e.retryable === true && e.attempts === 1);
  sim.faults.down503.POST = 1;
  await assert.rejects(ops.createIssueLink(user, { cloudId, type: "3. Blocking", inwardIssue: a.key, outwardIssue: b.key }), (e) => e.retryable === true);
  assert.equal(count(/^POST \/rest\/api\/2\/issue/), 3, "un solo tentativo per la creazione fallita");
  assert.equal(count(/^POST \/rest\/api\/3\/issueLink/), 1);
  assert.equal([...sim.issues.values()].filter((i) => i.summary === "Doppione?").length, 0);
  assert.deepEqual(waits, []);
});

test("anche le modifiche (PUT) non si riprovano", async () => {
  const t = await create({ summary: "Da spostare" });
  sim.faults.down503.PUT = 1;
  await assert.rejects(ops.setReleaseFields(user, { cloudId, issueKey: t.key, labels: ["R2"] }), (e) => e.retryable === true);
  assert.equal(count(/^PUT /), 1);
});

test("un Retry-After oltre il tetto non si aspetta: l'errore torna subito con l'attesa suggerita", async () => {
  sim.faults.rate429.GET = 1; sim.retryAfter = "120";
  await assert.rejects(ops.getIssueLinkTypes(user, { cloudId }), (e) => e.retryable === true && e.retryAfter === 120 && e.attempts === 1);
  assert.deepEqual(waits, []);
});

test("le attese restano entro il tetto complessivo, compatibile con maxDuration 60 s", async () => {
  assert.ok(RETRY.attempts <= 3 && RETRY.budgetMs <= 30_000 && RETRY.maxWaitMs <= RETRY.budgetMs);
  sim.faults.rate429.GET = 3; sim.retryAfter = "9";
  await assert.rejects(ops.getIssueLinkTypes(user, { cloudId }), (e) => e.attempts === 3);
  assert.deepEqual(waits, [9000, 9000]);
  waits = []; sim.faults.rate429.GET = 3; sim.retryAfter = "10.5"; // oltre maxWaitMs
  await assert.rejects(ops.getIssueLinkTypes(user, { cloudId }), (e) => e.attempts === 1);
  assert.deepEqual(waits, []);
});

test("Retry-After si legge in secondi o come data HTTP", () => {
  const now = Date.parse("2026-10-17T10:00:00Z");
  assert.equal(retryAfterMs("3", now), 3000);
  assert.equal(retryAfterMs("0.5", now), 500);
  assert.equal(retryAfterMs("Sat, 17 Oct 2026 10:00:04 GMT", now), 4000);
  assert.equal(retryAfterMs("Sat, 17 Oct 2026 09:00:00 GMT", now), 0);
  assert.equal(retryAfterMs(null, now), null);
  assert.equal(retryAfterMs("domani", now), null);
});

test("aggiornamento di un ticket creato: solo i campi passati, descrizione in wiki markup, controlli prima di Jira", async () => {
  const r = await create({ summary: "[BE] Vecchio titolo", description: "## Context\nprima", additional_fields: { labels: ["MVP"] } });
  const key = r.key;
  assert.deepEqual(await ops.editJiraIssue(user, { cloudId, issueKey: key }), { ok: true, unchanged: true });
  await ops.editJiraIssue(user, { cloudId, issueKey: key, summary: "[BE] Nuovo titolo", description: "## Context\n- dopo", labels: ["MVP", "Logic", "MVP"], additional_fields: { assignee: "x", customfield_100: "v" } });
  const i = sim.issues.get(key);
  assert.equal(i.summary, "[BE] Nuovo titolo");
  assert.equal(i.description, "h2. Context\n* dopo");
  assert.deepEqual(i.fields.labels, ["MVP", "Logic"]);
  assert.ok(sim.calls.includes(`PUT /rest/api/2/issue/${key}`));
  await assert.rejects(ops.editJiraIssue(user, { cloudId, issueKey: "non valida", summary: "x" }), { code: "tool_error" });
  await assert.rejects(ops.editJiraIssue(user, { cloudId, issueKey: key, labels: ["con spazio"] }), { code: "tool_error" });
  await assert.rejects(ops.editJiraIssue(user, { cloudId, issueKey: key, summary: "" }), { code: "tool_error" });
});

test("anche la creazione rifiuta le label con spazi o troppo lunghe, prima di chiamare Jira", async () => {
  const calls = sim.calls.length;
  await assert.rejects(create({ additional_fields: { labels: ["Release 1"] } }), (e) => e.code === "tool_error" && e.message === "Label non valida: niente spazi");
  await assert.rejects(create({ additional_fields: { labels: ["x".repeat(256)] } }), { code: "tool_error" });
  assert.equal(sim.calls.length, calls, "nessuna chiamata partita");
  const ok = await create({ additional_fields: { labels: [" MVP ", "MVP", "Logic"] } });
  assert.deepEqual(sim.issues.get(ok.key).fields.labels, ["MVP", "Logic"]);
});

test("gli errori di Jira portano lo status HTTP", async () => {
  await assert.rejects(ops.getJiraIssue(user, { cloudId, issueIdOrKey: "ORTO-9999" }), (e) => e.code === "tool_error" && e.status === 404);
  await assert.rejects(create({ additional_fields: { parent: { key: "ORTO-9999" } } }), (e) => e.status === 400);
  sim.faults.down503.GET = 3;
  await assert.rejects(ops.getIssueLinkTypes(user, { cloudId }), (e) => e.code === "server_unavailable" && e.status === 503);
});

/* ---------- Jira finto: comportamenti di Jira vero ---------- */
const raw = (path, init = {}) => fetch(`https://api.atlassian.com/ex/jira/${cloudId}${path}`, { ...init, body: init.body && JSON.stringify(init.body) });

test("il Jira finto rifiuta le label con spazi in creazione e in modifica, con un 400", async () => {
  const fields = { project: { key: sim.projectKey }, issuetype: { name: "Story" }, summary: "S", labels: ["Release 1"] };
  const c = await raw("/rest/api/2/issue", { method: "POST", body: { fields } });
  assert.equal(c.status, 400);
  assert.match((await c.json()).errors.labels, /contains spaces/);
  const t = await create({ summary: "Ok" });
  const p = await raw(`/rest/api/2/issue/${t.key}`, { method: "PUT", body: { fields: { labels: ["con spazio"] } } });
  assert.equal(p.status, 400);
  assert.equal(sim.issues.get(t.key).fields.labels, undefined, "la label non è stata scritta");
});

test("guasto hidden: il ticket esiste ma non si vede, come con i permessi mancanti", async () => {
  const a = await create({ summary: "Visibile" }), b = await create({ summary: "Nascosto" });
  sim.faults.hidden[b.key] = 1;
  await assert.rejects(ops.getJiraIssue(user, { cloudId, issueIdOrKey: b.key }), (e) => e.status === 404 && /permission/.test(e.message));
  await assert.rejects(ops.getJiraIssue(user, { cloudId, issueIdOrKey: b.key }), (e) => e.status === 404, "il guasto non si consuma");
  await assert.rejects(ops.searchJiraIssuesUsingJql(user, { cloudId, jql: `key in (${a.key}, ${b.key})` }), (e) => e.status === 400 && e.message.includes(b.key));
  assert.deepEqual((await search()).issues.map((i) => i.key), [a.key]);
  sim.reset();
  assert.deepEqual(sim.faults.hidden, {});
});

/* ---------- token cifrati e rinnovo ---------- */
// le chiamate al server OAuth (auth.atlassian.com) non passano dal Jira finto: si rispondono qui
async function withAuth(reply, fn) {
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).startsWith("https://auth.atlassian.com/") ? reply() : prev(url, init));
  try { return await fn(); } finally { globalThis.fetch = prev; }
}
const scaduto = async () => ({ ...user, expires_at: new Date(Date.now() - 1000).toISOString(), refresh_token: await seal("refresh-finto") });
const reply = (status, data) => () => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

test("un token cifrato che non si decifra più (chiave ruotata) chiede un nuovo accesso", async () => {
  await assert.rejects(ops.getIssueLinkTypes({ ...user, access_token: "AAAA.BBBB" }, { cloudId }), (e) => e.code === "needs_reauth");
  const rotto = { ...user, expires_at: new Date(Date.now() - 1000).toISOString(), refresh_token: "non-cifrato" };
  await assert.rejects(ops.getIssueLinkTypes(rotto, { cloudId }), (e) => e.code === "needs_reauth");
});

test("rinnovo del token: un 5xx o la rete giù sono temporanei, invalid_grant e i 4xx chiedono un nuovo accesso", async () => {
  const u = await scaduto();
  await withAuth(reply(503, { error: "unavailable" }), () => assert.rejects(ops.getIssueLinkTypes(u, { cloudId }), (e) => e.code === "server_unavailable" && e.retryable === true));
  await withAuth(reply(429, { error: "rate_limited" }), () => assert.rejects(ops.getIssueLinkTypes(u, { cloudId }), (e) => e.code === "server_unavailable" && e.retryable === true && e.status === 429));
  await withAuth(() => { throw new TypeError("fetch failed"); }, () => assert.rejects(ops.getIssueLinkTypes(u, { cloudId }), (e) => e.code === "server_unavailable" && e.retryable === true));
  await withAuth(reply(403, { error: "invalid_grant", error_description: "Unknown or invalid refresh token." }), () => assert.rejects(ops.getIssueLinkTypes(u, { cloudId }), (e) => e.code === "needs_reauth"));
  await withAuth(reply(400, { error: "invalid_request" }), () => assert.rejects(ops.getIssueLinkTypes(u, { cloudId }), (e) => e.code === "needs_reauth"));
});
