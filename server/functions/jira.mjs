// POST /api/jira/:op  {cloudId, ...input} → {ok, payload} | {ok:false, code, message}
import { json, fail, getUser, siteIds, sameOrigin } from "../lib/core.mjs";
import { ops } from "../lib/jira-ops.mjs";

export default async (req, context) => {
  if (req.method !== "POST") return fail("method", "Usa POST.", 405);
  const user = await getUser(req);
  if (!user) return fail("unauthenticated", "Accedi con Atlassian.", 401);
  if (!sameOrigin(req)) return fail("forbidden", "Richiesta non consentita.", 403);
  const op = context.params?.op;
  if (!Object.hasOwn(ops, op)) return fail("bad_request", "Operazione Jira sconosciuta.");
  const input = await req.json().catch(() => ({}));
  if (op !== "getAccessibleAtlassianResources" && !siteIds(user).includes(input.cloudId)) {
    return fail("forbidden_site", "Non hai accesso a questo sito Atlassian. Esci e accedi di nuovo per aggiornare i siti.", 403);
  }
  try {
    return json({ ok: true, payload: await ops[op](user, input) });
  } catch (e) {
    const code = e.code || "upstream_error";
    if (code !== "tool_error" && code !== "needs_reauth") console.log(`jira ${op} failed: ${code} ${String(e.message).slice(0, 300)}`);
    return json({ ok: false, code, message: e.message, retryable: !!e.retryable }, code === "needs_reauth" ? 401 : 200);
  }
};

export const config = { path: "/api/jira/:op" };
