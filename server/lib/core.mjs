// Utilità condivise dalle funzioni del server (Node su Vercel): solo Web API.
import { neon } from "@neondatabase/serverless";

export const env = (k) => process.env[k];

let _sql;
export const sql = (...args) => (_sql ??= neon(env("DATABASE_URL")))(...args);

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

export const fail = (code, message, status = 400) => json({ ok: false, code, message }, status);

export function getCookie(req, name) {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

export const isSecure = () => String(env("APP_URL") || "").startsWith("https://");
export const cookie = (name, value, { maxAge, path = "/" } = {}) =>
  `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=Lax` +
  (maxAge != null ? `; Max-Age=${maxAge}` : "") +
  (isSecure() ? "; Secure" : "");

// Le richieste che modificano dati devono arrivare dal sito stesso.
export function sameOrigin(req) {
  if (["GET", "HEAD"].includes(req.method)) return true;
  const origin = req.headers.get("origin");
  if (!origin) return true; // stessa origine senza header (alcuni browser): il cookie SameSite=Lax protegge comunque
  try {
    return new URL(origin).host === new URL(env("APP_URL") || req.url).host || new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

/* ---------- crittografia (Web Crypto) ---------- */
const enc = new TextEncoder();
const dec = new TextDecoder();
const toB64 = (buf) => {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
};
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");

export const randomId = (bytes = 32) => hex(crypto.getRandomValues(new Uint8Array(bytes)));
export const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

let keyPromise;
function tokenKey() {
  return (keyPromise ??= (async () => {
    const raw = fromB64(env("TOKEN_KEY") || "");
    if (raw.length !== 32) throw new Error("TOKEN_KEY deve essere di 32 byte in base64 (npm run key).");
    return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  })());
}
export async function seal(text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await tokenKey(), enc.encode(text));
  return `${toB64(iv)}.${toB64(ct)}`;
}
export async function unseal(sealed) {
  const [iv, ct] = String(sealed).split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await tokenKey(), fromB64(ct));
  return dec.decode(pt);
}

/* ---------- sessioni ---------- */
export const SESSION_COOKIE = "bs_session";
const SESSION_DAYS = 30;

export async function createSession(accountId) {
  const id = randomId();
  await sql`insert into sessions (id_hash, account_id, expires_at)
            values (${await sha256(id)}, ${accountId}, now() + make_interval(days => ${SESSION_DAYS}))`;
  return cookie(SESSION_COOKIE, id, { maxAge: SESSION_DAYS * 86400 });
}

export async function getUser(req) {
  const id = getCookie(req, SESSION_COOKIE);
  if (!id || !/^[0-9a-f]{64}$/.test(id)) return null;
  const rows = await sql`select u.* from sessions s join users u on u.account_id = s.account_id
                         where s.id_hash = ${await sha256(id)} and s.expires_at > now()`;
  return rows[0] || null;
}

export async function destroySession(req) {
  const id = getCookie(req, SESSION_COOKIE);
  if (id) await sql`delete from sessions where id_hash = ${await sha256(id)}`;
  return cookie(SESSION_COOKIE, "", { maxAge: 0 });
}

export const siteIds = (user) => (user?.sites || []).map((s) => s.id);
