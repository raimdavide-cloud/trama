// GET    /api/projects/:id?since=ISO   stato del progetto (solo le modifiche dopo `since`), in forma leggera:
//                                       testo dei documenti, log e qualità arrivano come segnaposto (server/lib/lazy.mjs)
// GET    /api/projects/:id/items/:col/:item   un documento completo (per i segnaposto)
// DELETE /api/projects/:id             elimina il progetto (solo chi l'ha creato)
// PUT    /api/projects/:id/items/:col/:item   salva un documento
// DELETE /api/projects/:id/items/:col/:item   elimina un documento
// POST   /api/projects/:id/batch  {ops:[{col,id,data|null}]}  salva o elimina più documenti in una volta (al massimo 500)
import { json, fail, getUser, sql, siteIds, sameOrigin } from "../lib/core.mjs";
import { lighten, isPlaceholder, fingerprint } from "../lib/lazy.mjs";

// presence: chi ha il progetto aperto (nome, passo, pannello); righe più vecchie di un giorno cancellate a ogni battito
const COLS = new Set(["meta", "docs", "reqs", "questions", "tickets", "decisions", "presence"]);
const META = new Set(["project", "kit", "jira", "chat", "runlog", "quality", "sprints"]);
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BYTES = 1_000_000;
const MAX_BATCH_BYTES = 4_000_000; // sotto il limite di 4,5 MB del corpo di una richiesta su Vercel
const MAX_OPS = 500;

const validPath = (col, item) => COLS.has(col) && ID.test(item || "") && (col !== "meta" || META.has(item));

async function loadProject(user, id) {
  if (!ID.test(id)) return null;
  const rows = await sql`select * from projects where id = ${id} and cloud_id = any(${siteIds(user)})`;
  return rows[0] || null;
}

export default async (req, context) => {
  const user = await getUser(req);
  if (!user) return fail("unauthenticated", "Accedi con Atlassian.", 401);
  if (!sameOrigin(req)) return fail("forbidden", "Richiesta non consentita: ricarica la pagina e riprova.", 403);
  const { id, col, item } = context.params || {};
  const project = await loadProject(user, id);
  if (!project) return fail("not_found", "Progetto inesistente o non accessibile con il tuo account.", 404);

  if (new URL(req.url).pathname.endsWith("/batch")) return batch(req, user, id);

  if (!col) {
    if (req.method === "GET") {
      const since = new URL(req.url).searchParams.get("since");
      const sinceDate = since && !Number.isNaN(Date.parse(since)) ? new Date(Date.parse(since) - 3000).toISOString() : null;
      const [{ now }] = await sql`select clock_timestamp() as now`;
      const items = sinceDate
        ? await sql`select col, id, data, deleted, updated_by from items where project_id = ${id} and updated_at > ${sinceDate}`
        : await sql`select col, id, data, deleted, updated_by from items where project_id = ${id} and not deleted`;
      return json({
        ok: true,
        now,
        project: { id: project.id, name: project.name, cloudId: project.cloud_id, siteUrl: project.site_url, createdBy: project.created_by },
        // by: chi ha fatto l'ultima modifica (ID Atlassian), per avvisare chi ha aperto lo stesso elemento
        items: items.map(({ updated_by, ...it }) => ({ ...lighten(it), by: updated_by || "" })),
      });
    }
    if (req.method === "DELETE") {
      if (project.created_by !== user.account_id) return fail("forbidden", "Solo chi ha creato il progetto può eliminarlo.", 403);
      await sql`delete from projects where id = ${id}`;
      return json({ ok: true });
    }
    return fail("method", "Metodo non supportato.", 405);
  }

  if (!validPath(col, item)) {
    return fail("invalid", "Percorso del documento non valido.");
  }
  if (req.method === "GET") {
    const rows = await sql`select data, deleted from items where project_id = ${id} and col = ${col} and id = ${item}`;
    if (!rows[0] || rows[0].deleted) return fail("not_found", "Documento inesistente o eliminato.", 404);
    return json({ ok: true, item: { col, id: item, data: rows[0].data, v: fingerprint(rows[0].data) } });
  }
  if (req.method === "PUT") {
    const text = await req.text();
    if (text.length > MAX_BYTES) return fail("too_large", "Documento troppo grande (massimo 1 MB): dividilo o accorcialo.", 413);
    let data;
    try { data = JSON.parse(text); } catch { return fail("invalid", "Il corpo deve essere JSON."); }
    if (!data || typeof data !== "object" || Array.isArray(data)) return fail("invalid", "Il documento deve essere un oggetto JSON.");
    if (isPlaceholder(data)) return fail("placeholder", "Contenuto non caricato: il documento completo non è stato sovrascritto.", 409);
    await sql`insert into items (project_id, col, id, data, deleted, updated_by, updated_at)
              values (${id}, ${col}, ${item}, ${JSON.stringify(data)}::jsonb, false, ${user.account_id}, clock_timestamp())
              on conflict (project_id, col, id) do update
                set data = excluded.data, deleted = false, updated_by = excluded.updated_by, updated_at = clock_timestamp()`;
    if (col === "presence") {
      // la presenza non cambia la data del progetto; i battiti vecchi (nome compreso) non restano
      await sql`delete from items where project_id = ${id} and col = 'presence' and updated_at < now() - interval '1 day'`;
    } else if (col === "meta" && item === "project" && data.name) {
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

// Salvataggio in blocco: una sola query invece di una richiesta per elemento (rinomina di una release, assegnazioni in massa).
// Le operazioni sulla stessa chiave si riducono all'ultima; un'eliminazione è un salvataggio con deleted = true.
async function batch(req, user, id) {
  if (req.method !== "POST") return fail("method", "Usa POST.", 405);
  const text = await req.text();
  if (text.length > MAX_BATCH_BYTES) return fail("too_large", "Troppi dati in una volta (massimo 4 MB).", 413);
  let body;
  try { body = JSON.parse(text); } catch { return fail("invalid", "Il corpo deve essere JSON."); }
  const ops = Array.isArray(body?.ops) ? body.ops : null;
  if (!ops?.length || ops.length > MAX_OPS) return fail("invalid", `Servono da 1 a ${MAX_OPS} operazioni.`);
  const last = new Map();
  for (const o of ops) {
    if (!o || !validPath(o.col, o.id)) return fail("invalid", "Percorso del documento non valido.");
    const del = o.data === null;
    if (!del && (!o.data || typeof o.data !== "object" || Array.isArray(o.data))) return fail("invalid", "Ogni documento deve essere un oggetto JSON.");
    if (!del && isPlaceholder(o.data)) return fail("placeholder", "Contenuto non caricato: il documento completo non è stato sovrascritto.", 409);
    if (!del && JSON.stringify(o.data).length > MAX_BYTES) return fail("too_large", "Documento troppo grande (massimo 1 MB): dividilo o accorcialo.", 413);
    last.set(`${o.col}/${o.id}`, { col: o.col, id: o.id, data: del ? null : o.data });
  }
  const rows = [...last.values()];
  await sql`insert into items (project_id, col, id, data, deleted, updated_by, updated_at)
            select ${id}, x.col, x.id, coalesce(x.data, '{}'::jsonb), x.data is null, ${user.account_id}, clock_timestamp()
            from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as x(col text, id text, data jsonb)
            on conflict (project_id, col, id) do update
              set data = excluded.data, deleted = excluded.deleted, updated_by = excluded.updated_by, updated_at = clock_timestamp()`;
  const named = rows.find((r) => r.col === "meta" && r.id === "project" && r.data?.name);
  if (named) await sql`update projects set updated_at = now(), name = ${String(named.data.name).slice(0, 120)} where id = ${id}`;
  else await sql`update projects set updated_at = now() where id = ${id}`;
  return json({ ok: true, saved: rows.length });
}

export const config = { path: ["/api/projects/:id", "/api/projects/:id/items/:col/:item", "/api/projects/:id/batch"] };
