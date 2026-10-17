// Utilità del server: cookie, stessa origine, cifratura dei token.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TOKEN_KEY = Buffer.alloc(32, 9).toString("base64");
const core = await import("../../server/lib/core.mjs");
const req = (init = {}, url = "https://trama.example/api/x") => new Request(url, init);

test("legge un cookie tra tanti, anche codificato", () => {
  const r = req({ headers: { cookie: "a=1; bs_session=ab%3Dcd; b=2" } });
  assert.equal(core.getCookie(r, "bs_session"), "ab=cd");
  assert.equal(core.getCookie(r, "manca"), null);
  assert.equal(core.getCookie(req(), "bs_session"), null);
});

test("il cookie di sessione è HttpOnly e Secure solo in https", () => {
  process.env.APP_URL = "https://trama.example";
  const c = core.cookie("bs_session", "x", { maxAge: 10 });
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Lax/);
  assert.match(c, /Max-Age=10/);
  assert.match(c, /Secure/);
  process.env.APP_URL = "http://localhost:8888";
  assert.doesNotMatch(core.cookie("bs_session", "x"), /Secure/);
});

test("le richieste che modificano dati devono arrivare dal sito stesso", () => {
  process.env.APP_URL = "https://trama.example";
  assert.equal(core.sameOrigin(req({ method: "GET", headers: { origin: "https://altro.example" } })), true, "le letture passano");
  assert.equal(core.sameOrigin(req({ method: "POST" })), true, "senza origin: protegge il cookie SameSite");
  assert.equal(core.sameOrigin(req({ method: "POST", headers: { origin: "https://trama.example" } })), true);
  assert.equal(core.sameOrigin(req({ method: "PUT", headers: { origin: "https://altro.example" } })), false);
  assert.equal(core.sameOrigin(req({ method: "DELETE", headers: { origin: "non un indirizzo" } })), false);
});

test("i token si cifrano e decifrano; ogni cifratura è diversa; un token alterato non si apre", async () => {
  const a = await core.seal("token-segreto"), b = await core.seal("token-segreto");
  assert.notEqual(a, b, "IV casuale");
  assert.equal(await core.unseal(a), "token-segreto");
  const [iv, ct] = a.split(".");
  const bad = `${iv}.${Buffer.from(Buffer.from(ct, "base64").map((x, i) => (i === 0 ? x ^ 1 : x))).toString("base64")}`;
  await assert.rejects(core.unseal(bad));
});

test("identificativi casuali e risposte JSON", async () => {
  assert.match(core.randomId(), /^[0-9a-f]{64}$/);
  assert.match(core.randomId(9), /^[0-9a-f]{18}$/);
  assert.notEqual(core.randomId(), core.randomId());
  const r = core.fail("invalid", "No.", 422);
  assert.equal(r.status, 422);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { ok: false, code: "invalid", message: "No." });
  assert.deepEqual(core.siteIds({ sites: [{ id: "a" }, { id: "b" }] }), ["a", "b"]);
  assert.deepEqual(core.siteIds(null), []);
});
