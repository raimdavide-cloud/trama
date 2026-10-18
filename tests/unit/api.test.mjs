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
    if (/^select col, id, data, deleted, updated_by from items/.test(q)) return db.items.filter((i) => i.project_id === v[0]).map((i) => ({ ...i, updated_by: i.by }));
    if (/^delete from items where project_id = \? and col = 'presence' and updated_at < now\(\) - interval '1 day'$/.test(q)) { db.presenceCleanups = (db.presenceCleanups || 0) + 1; return []; }
    if (/^select data, deleted from items where project_id = \? and col = \? and id = \?$/.test(q)) return db.items.filter((i) => i.project_id === v[0] && i.col === v[1] && i.id === v[2]).slice(-1);
    if (/^insert into items .* jsonb_to_recordset/.test(q)) { for (const r of JSON.parse(v[2])) db.items.push({ project_id: v[0], col: r.col, id: r.id, data: r.data, deleted: r.data === null, by: v[1] }); return []; }
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

test("homepage: /api/me?quiet=1 senza sessione risponde 200 con user null, senza svelare nulla", async () => {
  const q = await call("/api/me?quiet=1", { sid: "c".repeat(64) });
  assert.equal(q.status, 200);
  assert.deepEqual(await q.json(), { ok: true, user: null });
  assert.equal((await call("/api/me?quiet=1", { sid: "c".repeat(64), method: "DELETE", origin: "https://trama.example" })).status, 401, "solo in lettura");
  assert.equal((await (await call("/api/me?quiet=1")).json()).user.accountId, "u1", "con la sessione risponde come sempre");
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

test("salvataggio in blocco: più documenti in una query, l'ultima versione vince, eliminazioni comprese", async () => {
  const post = (body, o) => call("/api/projects/p1/batch", { method: "POST", body, ...o });
  const r = await post({ ops: [{ col: "reqs", id: "r1", data: { t: 1 } }, { col: "reqs", id: "r2", data: { t: 2 } }, { col: "reqs", id: "r1", data: { t: 3 } }, { col: "tickets", id: "t9", data: null }, { col: "meta", id: "project", data: { name: "Rinominato" } }] });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).saved, 4);
  assert.equal(db.log.filter((q) => /^insert into items/.test(q)).length, 1, "una sola query di scrittura");
  assert.deepEqual(db.items.map((i) => [i.col, i.id, i.data, i.deleted]), [["reqs", "r1", { t: 3 }, false], ["reqs", "r2", { t: 2 }, false], ["tickets", "t9", null, true], ["meta", "project", { name: "Rinominato" }, false]]);
  assert.equal(db.projects.p1.name, "Rinominato");
});

test("salvataggio in blocco: un'operazione non valida fa rifiutare tutto, nulla viene scritto", async () => {
  const post = (body, o) => call("/api/projects/p1/batch", { method: "POST", body, ...o });
  const bad = async (body, status = 400) => { const r = await post(body); assert.equal(r.status, status, JSON.stringify(body).slice(0, 80)); };
  await bad({ ops: [{ col: "reqs", id: "r1", data: { a: 1 } }, { col: "segreti", id: "x", data: {} }] });
  await bad({ ops: [{ col: "reqs", id: "r1", data: [1, 2] }] });
  await bad({ ops: [{ col: "meta", id: "qualsiasi", data: {} }] });
  await bad({ ops: [] });
  await bad({ ops: Array.from({ length: 501 }, (_, i) => ({ col: "reqs", id: "r" + i, data: {} })) });
  await bad({ ops: [{ col: "docs", id: "d1", data: { text: "x".repeat(1_000_001) } }] }, 413);
  assert.equal((await call("/api/projects/p1/batch")).status, 405);
  assert.equal((await post({ ops: [{ col: "reqs", id: "r1", data: {} }] }, { origin: "https://malevolo.example" })).status, 403);
  assert.equal((await call("/api/projects/pAltro/batch", { method: "POST", body: { ops: [{ col: "reqs", id: "r1", data: {} }] } })).status, 404);
  assert.equal(db.items.length, 0);
});

/* ---------- apertura leggera: segnaposto nello stato, contenuto completo su richiesta ---------- */
const { fingerprint } = await import("../../server/lib/lazy.mjs");
const TEXT = "Il sistema deve permettere la prenotazione degli orti. ".repeat(400);
const seed = () => db.items.push(
  { project_id: "p1", col: "docs", id: "d1", data: { name: "Capitolato.docx", kind: "Word", text: TEXT, chars: TEXT.length, truncated: false, at: 1 } },
  { project_id: "p1", col: "meta", id: "runlog", data: { at: 2, lines: ["riga 1", "riga 2", "riga 3"] } },
  { project_id: "p1", col: "meta", id: "quality", data: { at: 3, count: 9, findings: [{ id: "f1", status: "open", severity: "high" }, { id: "f2", status: "open", severity: "low" }, { id: "f3", status: "ignored", severity: "high" }] } },
  { project_id: "p1", col: "meta", id: "chat", data: { turns: [{ role: "user", content: "ciao" }] } },
  { project_id: "p1", col: "reqs", id: "r1", data: { title: "Prenotazione" } },
);

test("lo stato del progetto arriva leggero: testo dei documenti, log e qualità sono segnaposto", async () => {
  seed();
  for (const path of ["/api/projects/p1", "/api/projects/p1?since=2026-10-16T07:00:00.000Z"]) {
    const { items } = await (await call(path)).json();
    const by = Object.fromEntries(items.map((i) => [`${i.col}/${i.id}`, i.data]));
    assert.deepEqual(by["docs/d1"], { name: "Capitolato.docx", kind: "Word", chars: TEXT.length, truncated: false, at: 1, _lazy: { len: TEXT.length, v: fingerprint(db.items[0].data) } }, path);
    assert.deepEqual(by["meta/runlog"], { at: 2, n: 3, _lazy: { len: by["meta/runlog"]._lazy.len, v: fingerprint(db.items[1].data) } });
    assert.deepEqual(by["meta/quality"].sum, { n: 3, open: 2, high: 1 });
    assert.equal(by["meta/quality"].findings, undefined);
    assert.deepEqual(by["meta/chat"], db.items[3].data, "il resto arriva intero");
    assert.deepEqual(by["reqs/r1"], { title: "Prenotazione" });
    assert.ok(JSON.stringify(items).length < TEXT.length / 4);
  }
});

test("un documento completo si legge da solo, con gli stessi controlli di accesso", async () => {
  seed();
  const r = await call("/api/projects/p1/items/docs/d1");
  assert.equal(r.status, 200);
  const { item } = await r.json();
  assert.equal(item.data.text, TEXT);
  const { items } = await (await call("/api/projects/p1")).json();
  assert.equal(item.v, items.find((i) => i.id === "d1").data._lazy.v, "la versione coincide con quella del segnaposto");
  assert.equal((await (await call("/api/projects/p1/items/meta/quality")).json()).item.data.findings.length, 3);
  assert.equal((await call("/api/projects/p1/items/docs/d1", { sid: "c".repeat(64) })).status, 401);
  assert.equal((await call("/api/projects/pAltro/items/docs/d1")).status, 404, "progetto di un sito non accessibile");
  assert.equal((await call("/api/projects/p1/items/docs/nessuno")).status, 404);
  assert.equal((await call("/api/projects/p1/items/segreti/d1")).status, 400);
  db.items.push({ project_id: "p1", col: "docs", id: "d2", data: {}, deleted: true });
  assert.equal((await call("/api/projects/p1/items/docs/d2")).status, 404, "eliminato");
});

test("un segnaposto non sovrascrive mai il contenuto completo", async () => {
  seed();
  const n = db.items.length;
  const { items } = await (await call("/api/projects/p1")).json();
  const ph = items.find((i) => i.id === "d1").data;
  const r = await put("/api/projects/p1/items/docs/d1", ph);
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, "placeholder");
  const b = await call("/api/projects/p1/batch", { method: "POST", body: { ops: [{ col: "reqs", id: "r1", data: { title: "x" } }, { col: "meta", id: "quality", data: items.find((i) => i.id === "quality").data }] } });
  assert.equal(b.status, 409);
  assert.equal(db.items.length, n, "nulla è stato scritto");
  assert.equal(db.items[0].data.text, TEXT);
});

test("l'impronta non dipende dall'ordine delle chiavi (Postgres le riordina) ma cambia con il contenuto", () => {
  assert.equal(fingerprint({ a: 1, b: { c: [1, "x"], d: null } }), fingerprint({ b: { d: null, c: [1, "x"] }, a: 1 }));
  assert.notEqual(fingerprint({ text: "abc" }), fingerprint({ text: "abd" }));
  assert.equal(fingerprint({ a: 1, u: undefined }), fingerprint({ a: 1 }));
});

test("presenza: si salva come gli altri elementi, non cambia la data del progetto e pulisce i battiti vecchi; ogni elemento dice chi l'ha cambiato", async () => {
  const r = await put("/api/projects/p1/items/presence/u1", { name: "Uno", at: 1, step: "backlog" }, { origin: "https://trama.example" });
  assert.equal(r.status, 200);
  assert.equal(db.presenceCleanups, 1);
  assert.ok(!db.log.some((q) => /^update projects set updated_at/.test(q)), "la data del progetto non cambia");
  await put("/api/projects/p1/items/tickets/t1", { ref: "T-001" }, { origin: "https://trama.example", sid: SID2 });
  const items = (await (await call("/api/projects/p1")).json()).items;
  assert.equal(items.find((i) => i.col === "presence").by, "u1");
  assert.equal(items.find((i) => i.col === "tickets").by, "u2");
  assert.equal((await put("/api/projects/p1/items/presenza/u1", {}, { origin: "https://trama.example" })).status, 400, "raccolta sconosciuta");
});
