// Operazioni Jira esposte allo studio, contro il Jira finto del simulatore (nessuna chiamata vera).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");
const { sim } = await import("../sim/fake-jira.mjs");
const { ops, mdToWiki } = await import("../../server/lib/jira-ops.mjs");
const { seal } = await import("../../server/lib/core.mjs");

const user = { account_id: "u1", access_token: await seal("token-finto"), expires_at: new Date(Date.now() + 3600e3).toISOString(), sites: [{ id: sim.cloudId }] };
const cloudId = sim.cloudId;
const types = [{ id: "1", name: "Project", level: 3 }, { id: "2", name: "Fase", level: 2 }, { id: "3", name: "Feature Epic", level: 1 }, { id: "4", name: "Story", level: 0 }];

beforeEach(() => { sim.reset(); sim.types = types; sim.components = ["Web"]; sim.versions = []; sim.links = []; });

const create = (o) => ops.createJiraIssue(user, { cloudId, projectKey: "COM", issueTypeName: "Story", summary: "Ticket", ...o });

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
  await assert.rejects(create({ additional_fields: { parent: { key: "COM-9999" } } }), (e) => e.code === "tool_error");
});

test("chiavi e label non valide sono rifiutate prima di chiamare Jira", async () => {
  const calls = sim.calls.length;
  await assert.rejects(ops.getJiraIssue(user, { cloudId, issueIdOrKey: "COM-1; DROP" }), (e) => e.code === "tool_error");
  await assert.rejects(ops.setIssueParent(user, { cloudId, issueKey: "../x", parentKey: "COM-1" }), (e) => e.code === "tool_error");
  await assert.rejects(ops.setReleaseFields(user, { cloudId, issueKey: "COM-1", labels: ["con spazio"] }), (e) => e.code === "tool_error");
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
  assert.match(ok.key, /^COM-\d+$/);
});

test("senza token valido e senza rinnovo serve un nuovo accesso", async () => {
  const scaduto = { ...user, expires_at: new Date(Date.now() - 1000).toISOString(), refresh_token: null };
  await assert.rejects(ops.getIssueLinkTypes(scaduto, { cloudId }), (e) => e.code === "needs_reauth");
});

test("ricerca JQL, campi letti e collegamenti", async () => {
  const a = await create({ summary: "Diario colturale" }), b = await create({ summary: "Meteo" });
  const r = await ops.searchJiraIssuesUsingJql(user, { cloudId, jql: 'project = COM AND summary ~ "diario"', maxResults: 500 });
  assert.deepEqual(r.issues.map((i) => i.key), [a.key]);
  const one = await ops.getJiraIssue(user, { cloudId, issueIdOrKey: a.key, fields: ["summary", "bad field!"] });
  assert.equal(one.fields.summary, "Diario colturale");
  await ops.createIssueLink(user, { cloudId, type: "3. Blocking", inwardIssue: a.key, outwardIssue: b.key });
  assert.deepEqual(sim.links, [{ type: "3. Blocking", from: a.key, to: b.key }]);
});
