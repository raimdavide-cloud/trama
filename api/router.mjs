// Adattatore per Vercel: un'unica funzione che instrada /api/* verso gli stessi gestori usati su Netlify.
// I percorsi si leggono da `config.path` di ogni funzione in netlify/functions, così le due piattaforme restano allineate.
import authCallback, * as authCallbackMod from "../netlify/functions/auth-callback.mjs";
import authLogin, * as authLoginMod from "../netlify/functions/auth-login.mjs";
import authLogout, * as authLogoutMod from "../netlify/functions/auth-logout.mjs";
import jira, * as jiraMod from "../netlify/functions/jira.mjs";
import me, * as meMod from "../netlify/functions/me.mjs";
import project, * as projectMod from "../netlify/functions/project.mjs";
import projects, * as projectsMod from "../netlify/functions/projects.mjs";
import { fail } from "../netlify/lib/core.mjs";
import { runPrivacyReport } from "../netlify/lib/privacy.mjs";

const MODULES = [
  [authCallback, authCallbackMod], [authLogin, authLoginMod], [authLogout, authLogoutMod],
  [jira, jiraMod], [me, meMod], [project, projectMod], [projects, projectsMod],
];

// "/api/projects/:id/items/:col/:item" → espressione regolare + nomi dei parametri
const ROUTES = MODULES.flatMap(([handler, mod]) =>
  [].concat(mod.config?.path || []).map((path) => {
    const names = [];
    const source = path.replace(/:([A-Za-z]+)/g, (_, n) => { names.push(n); return "([^/]+)"; });
    return { re: new RegExp(`^${source}/?$`), names, handler };
  }),
);

const text = (status, body) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

// Equivalente della funzione pianificata di Netlify: Vercel la chiama una volta al giorno (vedi vercel.json),
// inviando `Authorization: Bearer <CRON_SECRET>`.
async function cron(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return text(401, "Unauthorized");
  try {
    const r = await runPrivacyReport();
    console.log(`privacy report: ${JSON.stringify(r)}`);
    return Response.json(r);
  } catch (e) {
    console.log(`privacy report failed: ${String(e.message || e).slice(0, 300)}`);
    return text(500, "Errore");
  }
}

export function match(pathname) {
  for (const { re, names, handler } of ROUTES) {
    const m = re.exec(pathname);
    if (m) return { handler, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

export async function route(req) {
  const { pathname } = new URL(req.url);
  if (pathname === "/api/cron/privacy-report") return cron(req);
  const found = match(pathname);
  if (!found) return fail("not_found", "Percorso inesistente.", 404);
  return found.handler(req, { params: found.params });
}

export default { fetch: route };
