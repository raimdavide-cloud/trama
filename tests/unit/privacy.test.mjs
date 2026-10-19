// Report privacy di Atlassian: chi si cancella e chi si aggiorna, con fetch e database finti.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

process.env.TOKEN_KEY = Buffer.alloc(32, 9).toString("base64");
const core = await import("../../server/lib/core.mjs");
const { runPrivacyReport } = await import("../../server/lib/privacy.mjs");

const SITI = [{ id: "sito-a" }, { id: "sito-b" }];
const realFetch = globalThis.fetch;
let db, report, profiles, calls;

// database finto: riconosce solo le query del report privacy
function fakeSql() {
  return async (strings, ...v) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim();
    if (/^select value from app_settings/.test(q)) return [];
    if (/^insert into app_settings/.test(q)) return [];
    if (/^select account_id, coalesce/.test(q)) return Object.values(db.users).map((u) => ({ account_id: u.account_id, at: "2026-10-01T00:00:00Z" }));
    if (/^select \* from users where refresh_token is not null/.test(q)) return [db.rep];
    if (/^update users set name = \?, email = \?, picture = \?/.test(q)) {
      Object.assign(db.users[v[3]], { name: v[0], email: v[1], picture: v[2], refreshed: true });
      return [];
    }
    if (/^update users set reported_at/.test(q)) return [];
    if (/^update items set updated_by = null/.test(q) || /^delete from items where col = 'presence'/.test(q) || /^update projects set created_by = null/.test(q)) return [];
    if (/^delete from users where account_id/.test(q)) { delete db.users[v[0]]; db.erased.push(v[0]); return []; }
    throw new Error(`query non prevista dal test: ${q}`);
  };
}

const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

beforeEach(async () => {
  db = {
    erased: [],
    rep: { account_id: "rep", access_token: await core.seal("token-rep"), expires_at: new Date(Date.now() + 3600e3).toISOString(), refresh_token: "x", sites: SITI },
    users: { u1: { account_id: "u1", name: "Anna", email: "anna@esempio.it", picture: "https://foto/anna" } },
  };
  report = [];
  profiles = {}; // per sito: { status, body } oppure "rete" per un errore di rete
  calls = [];
  core.setSqlForTests(fakeSql());
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u === "https://api.atlassian.com/app/report-accounts/") return json(200, { accounts: report });
    const m = u.match(/\/ex\/jira\/([^/]+)\/rest\/api\/3\/user\?/);
    if (m) {
      const p = profiles[m[1]] || { status: 404, body: {} };
      if (p === "rete") throw new TypeError("fetch failed");
      return json(p.status, p.body);
    }
    throw new Error(`chiamata non prevista: ${u}`);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const profileCalls = () => calls.filter((u) => u.includes("/rest/api/3/user?"));

test("un 404 o un 403 su tutti i siti non cancella nulla: il profilo può essere solo non visibile", async () => {
  report = [{ accountId: "u1", status: "updated" }];
  profiles = { "sito-a": { status: 404, body: {} }, "sito-b": { status: 403, body: {} } };
  const r = await runPrivacyReport({ force: true });
  assert.deepEqual(db.erased, []);
  assert.equal(db.users.u1.name, "Anna");
  assert.equal(r.updated, 0);
  assert.equal(profileCalls().length, 2, "provati entrambi i siti");
});

test("un 200 sul secondo sito aggiorna, e ci si ferma lì", async () => {
  report = [{ accountId: "u1", status: "updated" }];
  profiles = { "sito-a": { status: 404, body: {} }, "sito-b": { status: 200, body: { displayName: "Anna Rossi", emailAddress: "anna.rossi@esempio.it", avatarUrls: { "48x48": "https://foto/nuova" } } } };
  const r = await runPrivacyReport({ force: true });
  assert.deepEqual(db.users.u1, { account_id: "u1", name: "Anna Rossi", email: "anna.rossi@esempio.it", picture: "https://foto/nuova", refreshed: true });
  assert.equal(r.updated, 1);
});

test("un'email o una foto nascoste nel profilo si tolgono anche dai dati salvati", async () => {
  report = [{ accountId: "u1", status: "updated" }];
  profiles = { "sito-a": { status: 200, body: { displayName: "Anna R.", emailAddress: "", avatarUrls: {} } } };
  await runPrivacyReport({ force: true });
  assert.equal(db.users.u1.name, "Anna R.");
  assert.equal(db.users.u1.email, "");
  assert.equal(db.users.u1.picture, "");
  assert.equal(profileCalls().length, 1, "il secondo sito non serve");
});

test("con la rete giù o un 5xx tutto resta com'è", async () => {
  report = [{ accountId: "u1", status: "updated" }];
  profiles = { "sito-a": "rete", "sito-b": { status: 503, body: {} } };
  const r = await runPrivacyReport({ force: true });
  assert.deepEqual(db.erased, []);
  assert.equal(db.users.u1.refreshed, undefined);
  assert.equal(r.updated, 0);
});

test("solo «closed» nel report cancella l'account", async () => {
  report = [{ accountId: "u1", status: "closed" }];
  const r = await runPrivacyReport({ force: true });
  assert.deepEqual(db.erased, ["u1"]);
  assert.equal(r.closed, 1);
  assert.equal(profileCalls().length, 0);
});
