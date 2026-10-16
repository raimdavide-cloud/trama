// GET    /api/projects/:id?since=ISO   stato del progetto (solo le modifiche dopo `since`)
// DELETE /api/projects/:id             elimina il progetto (solo chi l'ha creato)
// PUT    /api/projects/:id/items/:col/:item   salva un documento
// DELETE /api/projects/:id/items/:col/:item   elimina un documento
import { json, fail, getUser, sql, siteIds, sameOrigin } from "../lib/core.mjs";

const COLS = new Set(["meta", "docs", "reqs", "questions", "tickets", "decisions"]);
const META = new Set(["project", "kit", "jira", "chat", "runlog", "quality", "sprints"]);
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BYTES = 1_000_000;

async function loadProject(user, id) {
  if (!ID.test(id)) return null;
  const rows = await sql`select * from projects where id = ${id} and cloud_id = any(${siteIds(user)})`;
  return rows[0] || null;
}

export default async (req, context) => {
  const user = await getUser(req);
  if (!user) return fail("unauthenticated", "Accedi con Atlassian.", 401);
  if (!sameOrigin(req)) return fail("forbidden", "Richiesta non consentita.", 403);
  const { id, col, item } = context.params || {};
  const project = await loadProject(user, id);
  if (!project) return fail("not_found", "Progetto inesistente o non accessibile con il tuo account.", 404);

  if (!col) {
    if (req.method === "GET") {
      const since = new URL(req.url).searchParams.get("since");
      const sinceDate = since && !Number.isNaN(Date.parse(since)) ? new Date(Date.parse(since) - 3000).toISOString() : null;
      const [{ now }] = await sql`select clock_timestamp() as now`;
      const items = sinceDate
        ? await sql`select col, id, data, deleted from items where project_id = ${id} and updated_at > ${sinceDate}`
        : await sql`select col, id, data, deleted from items where project_id = ${id} and not deleted`;
      return json({
        ok: true,
        now,
        project: { id: project.id, name: project.name, cloudId: project.cloud_id, siteUrl: project.site_url, createdBy: project.created_by },
        items,
      });
    }
    if (req.method === "DELETE") {
      if (project.created_by !== user.account_id) return fail("forbidden", "Solo chi ha creato il progetto può eliminarlo.", 403);
      await sql`delete from projects where id = ${id}`;
      return json({ ok: true });
    }
    return fail("method", "Metodo non supportato.", 405);
  }

  if (!COLS.has(col) || !ID.test(item || "") || (col === "meta" && !META.has(item))) {
    return fail("invalid", "Percorso del documento non valido.");
  }
  if (req.method === "PUT") {
    const text = await req.text();
    if (text.length > MAX_BYTES) return fail("too_large", "Documento troppo grande (massimo 1 MB).", 413);
    let data;
    try { data = JSON.parse(text); } catch { return fail("invalid", "Il corpo deve essere JSON."); }
    if (!data || typeof data !== "object" || Array.isArray(data)) return fail("invalid", "Il documento deve essere un oggetto JSON.");
    await sql`insert into items (project_id, col, id, data, deleted, updated_by, updated_at)
              values (${id}, ${col}, ${item}, ${JSON.stringify(data)}::jsonb, false, ${user.account_id}, clock_timestamp())
              on conflict (project_id, col, id) do update
                set data = excluded.data, deleted = false, updated_by = excluded.updated_by, updated_at = clock_timestamp()`;
    if (col === "meta" && item === "project" && data.name) {
      await sql`update projects set updated_at = now(), name = ${String(data.name).slice(0, 120)} where id = ${id}`;
    } else {
      await sql`update projects set updated_at = now() where id = ${id}`;
    }
    return json({ ok: true });
  }
  if (req.method === "DELETE") {
    await sql`update items set deleted = true, data = '{}'::jsonb, updated_by = ${user.account_id}, updated_at = clock_timestamp()
              where project_id = ${id} and col = ${col} and id = ${item}`;
    return json({ ok: true });
  }
  return fail("method", "Metodo non supportato.", 405);
};

export const config = { path: ["/api/projects/:id", "/api/projects/:id/items/:col/:item"] };
