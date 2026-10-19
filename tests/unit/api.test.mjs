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

// database finto: riconosce le query del server e tiene progetti, elementi e sessioni in memoria.
// Ogni elemento ha `at` (updated_at in µs, qui un contatore): le scritture fanno l'upsert e valutano la condizione come Postgres.
// `at` torna come numero e non come stringa: il server lo deve normalizzare comunque.
function fakeSql() {
  const find = (p, c, id) => db.items.find((i) => i.project_id === p && i.col === c && i.id === id);
  const tick = () => ++db.clock;
  const upsert = (row) => { const cur = find(row.project_id, row.col, row.id); cur ? Object.assign(cur, row) : db.items.push(row); return row; };
  return async (strings, ...v) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim();
    db.log.push(q);
    if (/from sessions s join users u/.test(q)) return db.sessions[v[0]] ? [db.users[db.sessions[v[0]]]] : [];
    if (/^select \* from projects where id = \? and cloud_id = any/.test(q)) { const p = db.projects[v[0]]; return p && v[1].includes(p.cloud_id) ? [p] : []; }
    if (/^select clock_timestamp/.test(q)) return [{ now: "2026-10-16T08:00:00.000Z" }];
    if (/^select col, id, data, deleted, updated_by, .* as at from items/.test(q)) return db.items.filter((i) => i.project_id === v[0] && (/updated_at > \?$/.test(q) || !i.deleted)).map((i) => ({ ...i, updated_by: i.by, at: i.at ?? null }));
    if (/^delete from items where project_id = \? and col = 'presence' and updated_at < now\(\) - interval '1 day'$/.test(q)) { db.presenceCleanups = (db.presenceCleanups || 0) + 1; return []; }
    if (/^select data, deleted, .* as at, .* as now from items where project_id = \? and col = \? and id = \?$/.test(q)) { const i = find(v[0], v[1], v[2]); return i ? [{ data: i.data, deleted: !!i.deleted, at: i.at ?? null, now: db.clock + 7 }] : []; }
    if (/^select deleted, .* as at from items where project_id = \? and col = \? and id = \?$/.test(q)) { const i = find(v[0], v[1], v[2]); return i ? [{ deleted: !!i.deleted, at: i.at ?? null }] : []; }
    if (/^insert into items .* jsonb_to_recordset/.test(q)) return JSON.parse(v[2]).map((r) => { const { col, id, at } = upsert({ project_id: v[0], col: r.col, id: r.id, data: r.data, deleted: r.data === null, by: v[1], at: tick() }); return { col, id, at }; });
    if (/^insert into items .* 'meta', 'project'/.test(q)) { db.items.push({ project_id: v[0], col: "meta", id: "project", data: JSON.parse(v[1]), by: v[2] }); return []; }
    if (/^insert into items/.test(q)) {
      const cur = find(v[0], v[1], v[2]);
      if (cur && !cur.deleted && / do update .* where items\.deleted returning /.test(q)) return [];
      return [{ at: upsert({ project_id: v[0], col: v[1], id: v[2], data: JSON.parse(v[3]), deleted: false, by: v[4], at: tick() }).at }];
    }
    if (/^update items set data = \?::jsonb, deleted = false, updated_by = \?, updated_at = clock_timestamp\(\) where project_id = \? and col = \? and id = \? and .* = \?::bigint returning /.test(q)) {
      const cur = find(v[2], v[3], v[4]);
      if (!cur || (/ and not deleted and /.test(q) && cur.deleted) || String(cur.at) !== v[5]) return [];
      return [{ at: Object.assign(cur, { data: JSON.parse(v[0]), deleted: false, by: v[1], at: tick() }).at }];
    }
    if (/^update items set deleted = true/.test(q)) {
      db.deleted.push([v[1], v[2], v[3]]);
      const cur = find(v[1], v[2], v[3]);
      if (!cur || (/ and not deleted and .* = \?::bigint returning /.test(q) && (cur.deleted || String(cur.at) !== v[4]))) return [];
      return [{ at: Object.assign(cur, { deleted: true, data: {}, by: v[0], at: tick() }).at }];
    }
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
    log: [], items: [], deleted: [], clock: 1_760_000_000_000_000,
    users: {
      u1: { account_id: "u1", name: "Uno", sites: [{ id: SITE, url: "https://a.atlassian.net" }] },
      u2: { account_id: "u2", name: "Due", sites: [{ id: SITE, url: "https://a.atlassian.net" }, { id: ALTRO, url: "https://b.atlassian.net" }] },
    },
    sessions: { [await core.sha256(SID)]: "u1", [await core.sha256(SID2)]: "u2" },
    projects: { p1: { id: "p1", name: "Prova", cloud_id: SITE, site_url: "https://a.atlassian.net", created_by: "u2" }, pAltro: { id: "pAltro", name: "Altro", cloud_id: ALTRO, created_by: "u2" } },
  };
  core.setSqlForTests(fakeSql());
});

const call = (path, { method = "GET", body, sid = SID, origin, headers } = {}) =>
  route(new Request(`https://trama.example${path}`, {
    method,
    headers: { cookie: `bs_session=${sid}`, ...(origin ? { origin } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
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
  assert.deepEqual(db.items.at(-1), { project_id: "p1", col: "reqs", id: "r1", data: { title: "Login" }, deleted: false, by: "u1", at: db.clock });
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
  await put("/api/projects/p1/items/meta/project", { name: "Nuovo nome", key: "ORTO" });
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

/* ---------- scrittura condizionale: x-base (versione su cui si basa la modifica) e 409 conflict ---------- */
const I = "/api/projects/p1/items";
const base = (b) => ({ headers: { "x-base": b } });
const del = (path, o) => call(path, { method: "DELETE", ...o });
const body = async (r) => ({ status: r.status, ...(await r.json()) });
const kit = () => db.items.find((i) => i.col === "meta" && i.id === "kit");

test("PUT con la base uguale a quella attuale scrive e restituisce la nuova versione", async () => {
  const a = await body(await put(`${I}/meta/kit`, { v: 1 }));
  assert.equal(a.status, 200);
  assert.equal(typeof a.at, "string", "at è sempre una stringa");
  const b = await body(await put(`${I}/meta/kit`, { v: 2 }, base(a.at)));
  assert.deepEqual([b.status, b.ok], [200, true]);
  assert.notEqual(b.at, a.at);
  assert.equal(b.at, String(kit().at));
  assert.deepEqual(kit().data, { v: 2 });
});

test("PUT con una base vecchia: 409 conflict con la versione attuale, nulla scritto", async () => {
  const a = await body(await put(`${I}/meta/kit`, { v: 1 }));
  const b = await body(await put(`${I}/meta/kit`, { v: 2 }, base(a.at)));
  const r = await body(await put(`${I}/meta/kit`, { v: 3 }, base(a.at)));
  assert.deepEqual([r.status, r.ok, r.code, r.at], [409, false, "conflict", b.at]);
  assert.deepEqual(kit().data, { v: 2 });
  const nuovo = await body(await put(`${I}/meta/sprints`, { v: 1 }, base(a.at)));
  assert.deepEqual([nuovo.status, nuovo.code, nuovo.at], [409, "conflict", null], "una base su un elemento inesistente è un conflitto, at null");
  assert.ok(!db.items.some((i) => i.id === "sprints"));
});

test("PUT con base none: scrive solo se l'elemento non esiste o è eliminato", async () => {
  const a = await body(await put(`${I}/meta/lock`, { by: "tab1" }, base("none")));
  assert.deepEqual([a.status, a.ok], [200, true], "inesistente");
  const r = await body(await put(`${I}/meta/lock`, { by: "tab2" }, base("none")));
  assert.deepEqual([r.status, r.code, r.at], [409, "conflict", a.at], "esistente");
  assert.deepEqual(db.items.find((i) => i.id === "lock").data, { by: "tab1" });
  await del(`${I}/meta/lock`);
  const c = await body(await put(`${I}/meta/lock`, { by: "tab2" }, base("none")));
  assert.deepEqual([c.status, c.ok], [200, true], "eliminato");
  assert.deepEqual(db.items.find((i) => i.id === "lock").data, { by: "tab2" });
});

test("PUT con una base numerica su un elemento eliminato non lo fa risorgere: 409 con at null, serve none", async () => {
  await put(`${I}/meta/kit`, { v: 1 });
  const d = await body(await del(`${I}/meta/kit`));
  const r = await body(await put(`${I}/meta/kit`, { v: 2 }, base(d.at)));
  assert.deepEqual([r.status, r.code, r.at], [409, "conflict", null], "anche con l'at esatto della riga eliminata");
  assert.equal(kit().deleted, true);
  assert.deepEqual(kit().data, {});
  assert.equal((await put(`${I}/meta/kit`, { v: 2 }, base("none"))).status, 200);
});

test("senza x-base la scrittura resta incondizionata, anche sopra la versione di un altro", async () => {
  await put(`${I}/meta/kit`, { v: 1 }, { sid: SID2 });
  await put(`${I}/meta/kit`, { v: 2 }, { sid: SID2 });
  const r = await body(await put(`${I}/meta/kit`, { v: 3 }));
  assert.deepEqual([r.status, r.ok], [200, true]);
  assert.deepEqual(kit().data, { v: 3 });
  assert.equal(r.at, String(kit().at));
});

test("DELETE condizionale: base vecchia 409; base giusta elimina; su un elemento eliminato o inesistente è idempotente", async () => {
  const a = await body(await put(`${I}/meta/kit`, { v: 1 }));
  const b = await body(await put(`${I}/meta/kit`, { v: 2 }));
  const no = await body(await del(`${I}/meta/kit`, base(a.at)));
  assert.deepEqual([no.status, no.code, no.at], [409, "conflict", b.at]);
  const none = await body(await del(`${I}/meta/kit`, base("none")));
  assert.deepEqual([none.status, none.code, none.at], [409, "conflict", b.at], "none su un elemento vivo");
  assert.equal(kit().deleted, false);
  const ok = await body(await del(`${I}/meta/kit`, base(b.at)));
  assert.deepEqual([ok.status, ok.ok], [200, true]);
  assert.equal(kit().deleted, true);
  assert.equal(ok.at, String(kit().at));
  const again = await body(await del(`${I}/meta/kit`, base(b.at)));
  assert.deepEqual([again.status, again.ok, again.at], [200, true, ok.at], "già eliminato: ok, nulla cambia");
  const missing = await body(await del(`${I}/meta/sprints`, base("123")));
  assert.deepEqual([missing.status, missing.ok, missing.at], [200, true, null], "inesistente");
  const plain = await body(await del(`${I}/reqs/r9`));
  assert.deepEqual([plain.status, plain.ok, plain.at], [200, true, null], "senza base, come prima");
});

test("un x-base malformato è una richiesta non valida, su PUT e DELETE; il batch ignora la base", async () => {
  for (const b of ["", "abc", "12a", "-5", "1.5", "NONE", "1".repeat(21), "9".repeat(20), "9".repeat(19)]) {
    const r = await body(await put(`${I}/meta/kit`, { v: 1 }, base(b)));
    assert.deepEqual([r.status, r.code], [400, "bad_request"], JSON.stringify(b));
    const d = await body(await del(`${I}/meta/kit`, base(b)));
    assert.deepEqual([d.status, d.code], [400, "bad_request"], JSON.stringify(b));
  }
  assert.equal(db.items.length, 0);
  assert.equal(db.deleted.length, 0);
  const r = await call("/api/projects/p1/batch", { method: "POST", body: { ops: [{ col: "meta", id: "kit", data: { v: 1 } }] }, ...base("1") });
  assert.equal(r.status, 200);
});

test("at viaggia nel poll (anche per gli eliminati), nel GET singolo con now, in PUT e nel batch, mai dentro data", async () => {
  const r1 = await body(await put(`${I}/reqs/r1`, { title: "Uno" }));
  const r2 = await body(await put(`${I}/reqs/r2`, { title: "Due" }));
  const d = await body(await del(`${I}/reqs/r2`));
  const init = (await (await call("/api/projects/p1")).json()).items;
  assert.deepEqual(init.map((i) => [i.id, i.at]), [["r1", r1.at]], "iniziale: solo i vivi");
  const since = (await (await call("/api/projects/p1?since=2026-10-16T07:00:00.000Z")).json()).items;
  assert.deepEqual(since.map((i) => [i.id, i.deleted, i.at]), [["r1", false, r1.at], ["r2", true, d.at]]);
  assert.notEqual(d.at, r2.at);
  assert.ok(since.every((i) => !("at" in i.data)));
  const g = await body(await call(`${I}/reqs/r1`));
  assert.deepEqual([g.item.at, typeof g.now, g.item.data], [r1.at, "string", { title: "Uno" }]);
  assert.ok(BigInt(g.now) >= BigInt(g.item.at), "now è nello stesso formato di at");
  const b = await body(await call("/api/projects/p1/batch", { method: "POST", body: { ops: [{ col: "reqs", id: "r1", data: { t: 1 } }, { col: "reqs", id: "r3", data: null }] } }));
  assert.deepEqual([b.ok, b.saved], [true, 2]);
  assert.deepEqual(b.items, db.items.filter((i) => ["r1", "r3"].includes(i.id)).map((i) => ({ col: "reqs", id: i.id, at: String(i.at) })));
});

test("meta/lock è un documento ammesso: si salva, si legge e si rilascia", async () => {
  const a = await body(await put(`${I}/meta/lock`, { by: "tab1", name: "Uno", kind: "create", until: "1" }, base("none")));
  assert.equal(a.status, 200);
  const g = await body(await call(`${I}/meta/lock`));
  assert.deepEqual([g.status, g.item.data.by, g.item.at], [200, "tab1", a.at]);
  const rel = await body(await put(`${I}/meta/lock`, {}, base(a.at)));
  assert.equal(rel.status, 200);
  const b = await body(await call("/api/projects/p1/batch", { method: "POST", body: { ops: [{ col: "meta", id: "lock", data: {} }] } }));
  assert.equal(b.status, 200);
});

test("un progetto senza autore (created_by null) lo elimina chiunque abbia accesso al sito, non chi è su un altro sito", async () => {
  db.projects.p1.created_by = null;
  db.projects.pAltro.created_by = null;
  assert.equal((await call("/api/projects/pAltro", { method: "DELETE" })).status, 404, "u1 non ha accesso al sito b");
  assert.ok(db.projects.pAltro);
  assert.equal((await call("/api/projects/p1", { method: "DELETE" })).status, 200);
  assert.equal(db.projects.p1, undefined);
});
