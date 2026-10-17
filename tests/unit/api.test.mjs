// API dei dati attraverso il router, con un database finto in memoria: chi può leggere, scrivere ed eliminare cosa.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.TOKEN_KEY = Buffer.alloc(32, 5).toString("base64");
process.env.APP_URL = "https://trama.example";
const core = await import("../../server/lib/core.mjs");
const { route } = await import("../../api/router.mjs");

const SITE = "sito-a", ALTRO = "sito-b";
const SID = "a".repeat(64), SID2 = "b".repeat(64);
let db;

// database finto: riconosce le query del server e tiene progetti, elementi e sessioni in memoria
function fakeSql() {
  return async (strings, ...v) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim();
    db.log.push(q);
    if (/from sessions s join users u/.test(q)) return db.sessions[v[0]] ? [db.users[db.sessions[v[0]]]] : [];
    if (/^select \* from projects where id = \? and cloud_id = any/.test(q)) { const p = db.projects[v[0]]; return p && v[1].includes(p.cloud_id) ? [p] : []; }
    if (/^select clock_timestamp/.test(q)) return [{ now: "2026-10-16T08:00:00.000Z" }];
    if (/^select col, id, data, deleted from items/.test(q)) return db.items.filter((i) => i.project_id === v[0]);
    if (/^insert into items .* 'meta', 'project'/.test(q)) { db.items.push({ project_id: v[0], col: "meta", id: "project", data: JSON.parse(v[1]), by: v[2] }); return []; }
    if (/^insert into items/.test(q)) { db.items.push({ project_id: v[0], col: v[1], id: v[2], data: JSON.parse(v[3]), by: v[4] }); return []; }
    if (/^update items set deleted = true/.test(q)) { db.deleted.push([v[1], v[2], v[3]]); return []; }
    if (/^update projects set updated_at = now\(\), name/.test(q)) { db.projects[v[1]].name = v[0]; return []; }
    if (/^update projects set updated_at/.test(q)) return [];
    if (/^delete from projects/.test(q)) { delete db.projects[v[0]]; return []; }
    if (/^insert into projects/.test(q)) { db.projects[v[0]] = { id: v[0], name: v[1], cloud_id: v[2], site_url: v[3], created_by: v[4] }; return []; }
    if (/from projects p left join users u/.test(q)) return Object.values(db.projects).filter((p) => v[0].includes(p.cloud_id));
    throw new Error(`query non prevista dal test: ${q}`);
  };
}

beforeEach(async () => {
  db = {
    log: [], items: [], deleted: [],
    users: {
      u1: { account_id: "u1", name: "Uno", sites: [{ id: SITE, url: "https://a.atlassian.net" }] },
      u2: { account_id: "u2", name: "Due", sites: [{ id: SITE, url: "https://a.atlassian.net" }, { id: ALTRO, url: "https://b.atlassian.net" }] },
    },
    sessions: { [await core.sha256(SID)]: "u1", [await core.sha256(SID2)]: "u2" },
    projects: { p1: { id: "p1", name: "Prova", cloud_id: SITE, site_url: "https://a.atlassian.net", created_by: "u2" }, pAltro: { id: "pAltro", name: "Altro", cloud_id: ALTRO, created_by: "u2" } },
  };
  core.setSqlForTests(fakeSql());
});

const call = (path, { method = "GET", body, sid = SID, origin } = {}) =>
  route(new Request(`https://trama.example${path}`, {
    method,
    headers: { cookie: `bs_session=${sid}`, ...(origin ? { origin } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  }));
const put = (path, body, o) => call(path, { method: "PUT", body, ...o });

test("una sessione inesistente o malformata non entra", async () => {
  assert.equal((await call("/api/me", { sid: "c".repeat(64) })).status, 401);
  assert.equal((await call("/api/me", { sid: "non-esadecimale" })).status, 401);
  const r = await call("/api/me");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).user.accountId, "u1");
});

test("si vedono solo i progetti dei propri siti Atlassian", async () => {
  const mine = await (await call("/api/projects")).json();
  assert.deepEqual(mine.projects.map((p) => p.id), ["p1"]);
  assert.equal((await call("/api/projects/pAltro")).status, 404, "progetto di un sito non accessibile");
  assert.equal((await put("/api/projects/pAltro/items/reqs/r1", { title: "x" })).status, 404);
  const p = await (await call("/api/projects/p1")).json();
  assert.equal(p.project.id, "p1");
});

test("un documento si salva solo con collezione, id e corpo validi", async () => {
  const ok = await put("/api/projects/p1/items/reqs/r1", { title: "Login" });
  assert.equal(ok.status, 200);
  assert.deepEqual(db.items.at(-1), { project_id: "p1", col: "reqs", id: "r1", data: { title: "Login" }, by: "u1" });
  const bad = async (path, body, code, status = 400) => {
    const r = await put(path, body);
    assert.equal(r.status, status, path);
    assert.equal((await r.json()).code, code, path);
  };
  await bad("/api/projects/p1/items/segreti/r1", { a: 1 }, "invalid");
  await bad("/api/projects/p1/items/meta/qualsiasi", { a: 1 }, "invalid");
  await bad("/api/projects/p1/items/reqs/..%2Fx", { a: 1 }, "invalid");
  await bad("/api/projects/p1/items/reqs/r1", "[1,2]", "invalid");
  await bad("/api/projects/p1/items/reqs/r1", "non è json", "invalid");
  await bad("/api/projects/p1/items/docs/d1", { text: "x".repeat(1_000_001) }, "too_large", 413);
  assert.equal(db.items.length, 1, "nessuna scrittura per le richieste rifiutate");
});

test("il nome del progetto salvato nei metadati aggiorna l'elenco", async () => {
  await put("/api/projects/p1/items/meta/project", { name: "Nuovo nome", key: "COM" });
  assert.equal(db.projects.p1.name, "Nuovo nome");
});

test("le scritture da un altro sito sono rifiutate", async () => {
  const r = await put("/api/projects/p1/items/reqs/r1", { title: "x" }, { origin: "https://malevolo.example" });
  assert.equal(r.status, 403);
  assert.equal(db.items.length, 0);
});

test("eliminare un elemento lo segna come eliminato; il progetto lo elimina solo chi l'ha creato", async () => {
  assert.equal((await call("/api/projects/p1/items/reqs/r1", { method: "DELETE" })).status, 200);
  assert.deepEqual(db.deleted, [["p1", "reqs", "r1"]]);
  const no = await call("/api/projects/p1", { method: "DELETE" });
  assert.equal(no.status, 403);
  assert.ok(db.projects.p1, "il progetto resta");
  assert.equal((await call("/api/projects/p1", { method: "DELETE", sid: SID2 })).status, 200);
  assert.equal(db.projects.p1, undefined);
});

test("un nuovo progetto vuole un nome e un sito a cui si ha accesso", async () => {
  const post = (body) => call("/api/projects", { method: "POST", body });
  assert.equal((await post({ name: " ", cloudId: SITE })).status, 400);
  assert.equal((await post({ name: "X", cloudId: ALTRO })).status, 403);
  const r = await post({ name: "Orto", cloudId: SITE });
  assert.equal(r.status, 201);
  const { project } = await r.json();
  assert.equal(db.projects[project.id].created_by, "u1");
  assert.deepEqual(db.items.at(-1).data, { name: "Orto", cloudId: SITE, siteUrl: "https://a.atlassian.net" });
});

test("le operazioni Jira: solo POST, solo operazioni note, solo sui propri siti", async () => {
  assert.equal((await call("/api/jira/getIssueLinkTypes")).status, 405);
  const unknown = await call("/api/jira/deleteEverything", { method: "POST", body: { cloudId: SITE } });
  assert.equal((await unknown.json()).code, "bad_request");
  const other = await call("/api/jira/getIssueLinkTypes", { method: "POST", body: { cloudId: ALTRO } });
  assert.equal(other.status, 403);
  assert.equal((await other.json()).code, "forbidden_site");
});
