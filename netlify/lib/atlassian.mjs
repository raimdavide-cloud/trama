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

async function tokenRequest(body) {
  const r = await fetch(`${AUTH}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: env("ATLASSIAN_CLIENT_ID"), client_secret: env("ATLASSIAN_CLIENT_SECRET"), ...body }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error_description || data.error || `token ${r.status}`), { code: "needs_reauth" });
  return data;
}

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
    return unseal(user.access_token);
  }
  if (!user.refresh_token) throw Object.assign(new Error("Sessione Atlassian scaduta"), { code: "needs_reauth" });
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: await unseal(user.refresh_token) });
  const sites = await fetchSites(t.access_token).catch(() => null);
  await saveTokens(user.account_id, t, { sites });
  if (sites) user.sites = sites;
  return t.access_token;
}

function jiraError(status, body) {
  const msgs = [...(body?.errorMessages || []), ...Object.entries(body?.errors || {}).map(([k, v]) => `${k}: ${v}`)];
  const message = msgs.join(" · ") || body?.message || `Jira ha risposto ${status}`;
  if (status === 401) return Object.assign(new Error(message), { code: "needs_reauth" });
  if (status === 429 || status >= 500) return Object.assign(new Error(message), { code: "server_unavailable", retryable: true });
  return Object.assign(new Error(message), { code: "tool_error" });
}

// Chiamata REST a Jira Cloud del sito cloudId, con un rinnovo del token in caso di 401.
export async function jiraFetch(user, cloudId, path, { method = "GET", body } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(user, attempt > 0);
    let r;
    try {
      r = await fetch(`${API}/ex/jira/${encodeURIComponent(cloudId)}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw Object.assign(new Error("Jira non raggiungibile"), { code: "server_unavailable", retryable: true });
    }
    if (r.status === 401 && attempt === 0) continue;
    const text = await r.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 300) }; }
    if (!r.ok) throw jiraError(r.status, data);
    return data;
  }
}
