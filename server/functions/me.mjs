import { json, fail, getUser, sameOrigin, destroySession } from "../lib/core.mjs";
import { erasePerson } from "../lib/privacy.mjs";

export default async (req) => {
  const user = await getUser(req);
  // ?quiet=1 (homepage): chi non ha fatto l'accesso riceve 200 con user null, senza un errore in console per ogni visitatore
  if (!user) return req.method === "GET" && new URL(req.url).searchParams.get("quiet") === "1" ? json({ ok: true, user: null }) : fail("unauthenticated", "Accedi con Atlassian.", 401);
  // Cancellazione dei propri dati personali (account, token, sessioni). I progetti restano, senza riferimento all'autore.
  if (req.method === "DELETE") {
    if (!sameOrigin(req)) return fail("forbidden", "Richiesta non consentita: ricarica la pagina e riprova.", 403);
    const cookie = await destroySession(req);
    await erasePerson(user.account_id);
    return json({ ok: true }, 200, { "set-cookie": cookie });
  }
  return json({
    ok: true,
    user: { accountId: user.account_id, name: user.name, email: user.email, picture: user.picture },
    sites: user.sites || [],
  });
};

export const config = { path: "/api/me" };
