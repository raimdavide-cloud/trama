import { sql, getCookie, cookie, createSession, seal } from "../lib/core.mjs";
import { exchangeCode, apiGet, fetchSites } from "../lib/atlassian.mjs";

const page = (title, text) =>
  new Response(
    `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="font:16px/1.5 system-ui,sans-serif;max-width:560px;margin:12vh auto;padding:0 16px;color:#161b26;background:#f4f5f8">
<h1 style="font-size:24px">${title}</h1><p>${text}</p><p><a href="/api/auth/login">Riprova ad accedere</a> · <a href="/">Torna alla home</a></p></body></html>`,
    { status: 400, headers: { "content-type": "text/html; charset=utf-8" } },
  );

export default async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("error")) return page("Accesso annullato", "Non hai autorizzato Trama ad accedere a Jira.");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || state !== getCookie(req, "bs_oauth_state")) {
    return page("Accesso non valido", "La richiesta di accesso è scaduta o non è partita da questo sito.");
  }
  try {
    const t = await exchangeCode(code);
    const sites = await fetchSites(t.access_token);
    if (!sites.length) return page("Nessun sito Jira", "Il tuo account Atlassian non ha accesso a nessun sito Jira con i permessi richiesti.");
    const my = await apiGet(`/ex/jira/${encodeURIComponent(sites[0].id)}/rest/api/3/myself`, t.access_token);
    const me = {
      account_id: my.accountId,
      name: my.displayName,
      email: my.emailAddress || "",
      picture: my.avatarUrls?.["48x48"] || "",
    };
    const access = await seal(t.access_token);
    const refresh = t.refresh_token ? await seal(t.refresh_token) : null;
    await sql`insert into users (account_id, name, email, picture, access_token, refresh_token, expires_at, sites, data_updated_at)
              values (${me.account_id}, ${me.name || me.nickname || ""}, ${me.email || ""}, ${me.picture || ""},
                      ${access}, ${refresh}, now() + make_interval(secs => ${Number(t.expires_in) || 3600}), ${JSON.stringify(sites)}::jsonb, now())
              on conflict (account_id) do update set name = excluded.name, email = excluded.email, picture = excluded.picture,
                access_token = excluded.access_token, refresh_token = coalesce(excluded.refresh_token, users.refresh_token),
                expires_at = excluded.expires_at, sites = excluded.sites, data_updated_at = now(), updated_at = now()`;
    const headers = new Headers({ location: "/studio" });
    headers.append("set-cookie", await createSession(me.account_id));
    headers.append("set-cookie", cookie("bs_oauth_state", "", { maxAge: 0, path: "/api/auth" }));
    return new Response(null, { status: 302, headers });
  } catch (e) {
    const detail = String(e?.message || e).replace(/[<>&]/g, "").slice(0, 200);
    console.log(`auth callback failed: ${detail}`);
    return page("Accesso non riuscito", `Atlassian non ha confermato l'accesso. Riprova tra qualche istante. <br><small style="color:#566079">Dettaglio: ${detail}</small>`);
  }
};

export const config = { path: "/api/auth/callback" };
