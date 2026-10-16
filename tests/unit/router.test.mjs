// Il router di Vercel: percorsi, parametri e risposte senza sessione (nessun accesso al database).
import { test } from "node:test";
import assert from "node:assert/strict";
import { match, route } from "../../api/router.mjs";

const req = (path, init) => new Request(`http://localhost${path}`, init);

test("riconosce i percorsi e ne estrae i parametri", () => {
  const m = match("/api/projects/abc/items/reqs/r%201");
  assert.ok(m, "percorso non riconosciuto");
  assert.deepEqual({ ...m.params }, { id: "abc", col: "reqs", item: "r 1" });
  assert.ok(match("/api/me"));
  assert.ok(match("/api/jira/getJiraIssue"));
  assert.equal(match("/api/nonesiste"), null);
});

test("un percorso sconosciuto risponde 404", async () => {
  const r = await route(req("/api/nonesiste"));
  assert.equal(r.status, 404);
  assert.equal((await r.json()).code, "not_found");
});

test("senza sessione le API dei dati rispondono 401", async () => {
  for (const path of ["/api/me", "/api/projects", "/api/projects/abc"]) {
    const r = await route(req(path));
    assert.equal(r.status, 401, path);
  }
});

test("il cron della privacy rifiuta le chiamate senza segreto", async () => {
  process.env.CRON_SECRET = "segreto-di-prova-1234";
  assert.equal((await route(req("/api/cron/privacy-report"))).status, 401);
  assert.equal((await route(req("/api/cron/privacy-report", { headers: { authorization: "Bearer sbagliato" } }))).status, 401);
});
