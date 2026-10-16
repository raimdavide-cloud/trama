// GET /api/projects: progetti dei siti Atlassian a cui l'utente accede
// POST /api/projects {name, cloudId}: nuovo progetto
import { json, fail, getUser, sql, siteIds, sameOrigin, randomId } from "../lib/core.mjs";

export default async (req) => {
  const user = await getUser(req);
  if (!user) return fail("unauthenticated", "Accedi con Atlassian.", 401);
  if (!sameOrigin(req)) return fail("forbidden", "Richiesta non consentita.", 403);
  const sites = siteIds(user);

  if (req.method === "GET") {
    if (!sites.length) return json({ ok: true, projects: [] });
    const rows = await sql`
      select p.id, p.name, p.cloud_id, p.site_url, p.created_at, p.updated_at, p.created_by, u.name as created_by_name,
        (select count(*) from items i where i.project_id = p.id and i.col = 'reqs' and not i.deleted)::int as reqs,
        (select count(*) from items i where i.project_id = p.id and i.col = 'tickets' and not i.deleted)::int as tickets,
        (select i.data->>'key' from items i where i.project_id = p.id and i.col = 'meta' and i.id = 'project') as jira_key
      from projects p left join users u on u.account_id = p.created_by
      where p.cloud_id = any(${sites})
      order by p.updated_at desc limit 200`;
    return json({ ok: true, projects: rows });
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "").trim().slice(0, 120);
    const site = (user.sites || []).find((s) => s.id === body.cloudId);
    if (!name) return fail("invalid", "Dai un nome al progetto.");
    if (!site) return fail("forbidden_site", "Non hai accesso a questo sito Atlassian.", 403);
    const id = randomId(9);
    await sql`insert into projects (id, name, cloud_id, site_url, created_by)
              values (${id}, ${name}, ${site.id}, ${site.url}, ${user.account_id})`;
    await sql`insert into items (project_id, col, id, data, updated_by)
              values (${id}, 'meta', 'project', ${JSON.stringify({ name, cloudId: site.id, siteUrl: site.url })}::jsonb, ${user.account_id})`;
    return json({ ok: true, project: { id, name, cloud_id: site.id, site_url: site.url } }, 201);
  }

  return fail("method", "Metodo non supportato.", 405);
};

export const config = { path: "/api/projects" };
