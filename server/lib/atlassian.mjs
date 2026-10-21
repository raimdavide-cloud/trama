// OAuth 2.0 (3LO) Atlassian e chiamate REST a Jira Cloud con il token dell'utente.
import { env, sql, seal, unseal } from "./core.mjs";

// Solo scope della Jira API (più offline_access): l'identità si legge da /rest/api/3/myself
export const SCOPES = ["read:jira-work", "write:jira-work", "read:jira-user", "offline_access"];
const AUTH = "https://auth.atlassian.com";
const API = "https://api.atlassian.com";

export const redirectUri = () => `${String(env("APP_URL") || "").replace(/\/$/, "")}/api/auth/callback`;

export function authorizeUrl(state) {
  const u = new URL(`${AUTH}/authorize`);
  u.search = new URLSearchParams({
    audience: "api.atlassian.com",
    client_id: env("ATLASSIAN_CLIENT_ID") || "",
    scope: SCOPES.join(" "),
    redirect_uri: redirectUri(),
    state,
    response_type: "code",
    prompt: "consent",
  }).toString();
  return u.toString();
}

// Un 5xx, un 429 o la rete giù non dicono che la sessione è finita: si riprova più tardi senza far rientrare l'utente.
async function tokenRequest(body) {
  let r;
  try {
    r = await fetch(`${AUTH}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: env("ATLASSIAN_CLIENT_ID"), client_secret: env("ATLASSIAN_CLIENT_SECRET"), ...body }),
    });
  } catch {
    throw Object.assign(new Error("Atlassian non raggiungibile"), { code: "server_unavailable", retryable: true });
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 429 || r.status >= 500) throw Object.assign(new Error(`Atlassian ha risposto ${r.status}`), { code: "server_unavailable", retryable: true, status: r.status });
  if (!r.ok) throw Object.assign(new Error(data.error_description || data.error || `token ${r.status}`), { code: "needs_reauth" });
  return data;
}

// Un token che non si decifra più (TOKEN_KEY ruotata, dato corrotto) vale come sessione scaduta.
// TOKEN_KEY assente o malformata è invece un errore di configurazione: passa così com'è (lo lancia tokenKey() in core.mjs).
const open = (sealed) =>
  unseal(sealed).catch((e) => {
    if (/^TOKEN_KEY/.test(e?.message || "")) throw e;
    console.log(`token Atlassian non decifrabile: ${e?.name || "errore"}, serve un nuovo accesso`);
    throw Object.assign(new Error("Sessione Atlassian non più leggibile: accedi di nuovo"), { code: "needs_reauth" });
  });

export const exchangeCode = (code) =>
  tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri() });

export async function apiGet(path, accessToken) {
  const r = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } });
  if (!r.ok) throw Object.assign(new Error(`Atlassian ${r.status}`), { code: r.status === 401 ? "needs_reauth" : "server_unavailable" });
  return r.json();
}

export const fetchSites = async (accessToken) =>
  (await apiGet("/oauth/token/accessible-resources", accessToken))
    .filter((s) => (s.scopes || []).some((x) => x.includes("jira")))
    .map((s) => ({ id: s.id, url: s.url, name: s.name }));

export async function saveTokens(accountId, t, extra = {}) {
  const access = await seal(t.access_token);
  const refresh = t.refresh_token ? await seal(t.refresh_token) : null;
  await sql`update users set access_token = ${access},
              refresh_token = coalesce(${refresh}, refresh_token),
              expires_at = now() + make_interval(secs => ${Number(t.expires_in) || 3600}),
              sites = coalesce(${extra.sites ? JSON.stringify(extra.sites) : null}::jsonb, sites),
              updated_at = now()
            where account_id = ${accountId}`;
}

// Restituisce un access token valido, rinnovandolo se scade entro un minuto.
export async function accessToken(user, force = false) {
  if (!force && user.access_token && user.expires_at && new Date(user.expires_at).getTime() - Date.now() > 60_000) {
    return open(user.access_token);
  }
  if (!user.refresh_token) throw Object.assign(new Error("Sessione Atlassian scaduta"), { code: "needs_reauth" });
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: await open(user.refresh_token) });
  const sites = await fetchSites(t.access_token).catch(() => null);
  await saveTokens(user.account_id, t, { sites });
  if (sites) user.sites = sites;
  return t.access_token;
}

function jiraError(status, body) {
  const msgs = [...(body?.errorMessages || []), ...Object.entries(body?.errors || {}).map(([k, v]) => `${k}: ${v}`)];
  const message = msgs.join(" · ") || body?.message || `Jira ha risposto ${status}`;
  if (status === 401) return Object.assign(new Error(message), { code: "needs_reauth", status });
  if (status === 429 || status >= 500) return Object.assign(new Error(message), { code: "server_unavailable", retryable: true, status });
  return Object.assign(new Error(message), { code: "tool_error", status });
}

// Limiti di Jira: si riprovano solo le letture (GET) e le ricerche JQL, che non cambiano nulla.
// Le creazioni (ticket, collegamenti) non si riprovano mai qui: una risposta persa non dice se il ticket esiste,
// e Trama lo riconcilia da sé (ricerca dei creati, «Cerca in Jira»).
// Tetti pensati per maxDuration 60 s (vercel.json): al massimo 3 tentativi e 20 s di attesa in tutto.
export const RETRY = {
  attempts: 3,
  baseMs: 500,
  maxWaitMs: 10_000, // un Retry-After più lungo non si aspetta: l'errore torna subito, temporaneo
  budgetMs: 20_000,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  random: Math.random,
};
const canRetry = (method, path) => method === "GET" || (method === "POST" && /^\/rest\/api\/3\/search\/jql(\?|$)/.test(path));

// Retry-After in secondi o come data HTTP; null se assente o illeggibile
export function retryAfterMs(value, now = Date.now()) {
  if (value == null || String(value).trim() === "") return null;
  const v = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}
// attesa prima del tentativo successivo: quella chiesta da Jira, altrimenti esponenziale con margine casuale
const backoff = (tries) => RETRY.baseMs * 2 ** (tries - 1) + Math.round(RETRY.random() * RETRY.baseMs);

// Chiamata REST a Jira Cloud del sito cloudId, con un rinnovo del token in caso di 401
// e nuovi tentativi su 429 e 5xx per le sole richieste che si possono ripetere.
export async function jiraFetch(user, cloudId, path, { method = "GET", body, form } = {}) {
  const repeatable = canRetry(method, path);
  let refreshed = false, force = false, tries = 0, waited = 0;
  // true se conviene riprovare: in quel caso ha già atteso
  const pause = async (ms) => {
    if (!repeatable || tries >= RETRY.attempts || ms == null || ms > RETRY.maxWaitMs || waited + ms > RETRY.budgetMs) return false;
    waited += ms;
    await RETRY.sleep(ms);
    return true;
  };
  for (;;) {
    tries++;
    const token = await accessToken(user, force);
    force = false;
    let r;
    try {
      r = await fetch(`${API}/ex/jira/${encodeURIComponent(cloudId)}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(form ? { "x-atlassian-token": "no-check" } : body ? { "content-type": "application/json" } : {}), // gli allegati sono multipart: il tipo lo imposta fetch
        },
        body: form || (body ? JSON.stringify(body) : undefined),
      });
    } catch (e) {
      if (await pause(backoff(tries))) continue;
      throw Object.assign(new Error("Jira non raggiungibile"), { code: "server_unavailable", retryable: true });
    }
    if (r.status === 401 && !refreshed) { refreshed = force = true; tries--; continue; } // il rinnovo del token non conta come tentativo
    const text = await r.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 300) }; }
    if (r.ok) return data;
    if (r.status === 429 || r.status >= 500) {
      const asked = retryAfterMs(r.headers.get("retry-after"));
      if (await pause(asked ?? backoff(tries))) continue;
      const err = jiraError(r.status, data);
      if (asked != null) err.retryAfter = Math.ceil(asked / 1000);
      err.attempts = tries;
      throw err;
    }
    throw jiraError(r.status, data);
  }
}
