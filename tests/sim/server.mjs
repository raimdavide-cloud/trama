// Server locale per i test: pagine vere di Trama, API in memoria e Jira finto.
// Nessun dato esce dal computer e il database non viene mai toccato.
// Uso: node tests/sim/server.mjs   (porta: PORT, predefinita 8899)
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join } from "node:path";

process.env.TOKEN_KEY ||= Buffer.alloc(32, 7).toString("base64"); // chiave finta: cifra solo il token finto qui sotto
const ROOT = new URL("../..", import.meta.url).pathname;
const PORT = Number(process.env.PORT || 8899);
const { sim } = await import("./fake-jira.mjs"); // installa il fetch finto prima di caricare le operazioni vere
const { ops } = await import("../../server/lib/jira-ops.mjs");
const { seal } = await import("../../server/lib/core.mjs");
const { lighten, isPlaceholder, fingerprint } = await import("../../server/lib/lazy.mjs"); // stessa apertura leggera del server
const fixture = JSON.parse(readFileSync(new URL("../fixtures/progetto-prova.json", import.meta.url)));

sim.cloudId = fixture.project.cloud_id;
sim.components = ["OrtoComune - Web App", "OrtoComune - Mobile App", "OrtoComune - Cloud"];
sim.versions = ["0.1.0"];
sim.types = fixture.items.find((i) => i.col === "meta" && i.id === "project").data.issueTypes;

const user = {
  ...fixture.user,
  access_token: await seal("token-finto"),
  expires_at: new Date(Date.now() + 3600e3).toISOString(),
};

// Scenario «progetto nuovo»: stessi documenti, requisiti e ticket, ma nulla è ancora stato creato in Jira.
// Con /__sim/reset?completo=1 il progetto di prova resta com'è (già creato, con log e controllo di qualità).
// at: versione dell'elemento in microsecondi come il server (updated_at), da un contatore che non torna mai indietro né si ripete
let store, lastAt = 0;
const tick = () => (lastAt = Math.max(lastAt + 1, Date.now() * 1000));
const nowUs = () => String(Math.max(lastAt, Date.now() * 1000));
let api503 = 0; // guasto: le prossime N scritture su /api/projects/* rispondono 503
function resetStore(completo = false) {
  store = new Map(fixture.items.map((i) => [`${i.col}/${i.id}`, { col: i.col, id: i.id, data: structuredClone(i.data), deleted: false, at: tick() }]));
  if (completo) return;
  const kit = store.get("meta/kit").data;
  if (kit.hier) { kit.hier.project.key = ""; kit.hier.phases.forEach((f) => (f.key = "")); }
  kit.epics.forEach((e) => { e.key = ""; delete e.linkedTo; });
  for (const [, v] of store) if (v.col === "tickets") { v.data.key = ""; v.data.state = "draft"; v.data.err = ""; delete v.data.issueKey; delete v.data.verify; delete v.data.verifyNote; }
  store.delete("meta/runlog"); store.delete("meta/quality");
}
resetStore();

// stesse intestazioni di sicurezza della produzione (vercel.json › "/(.*)"), CSP compresa
const SECURITY = JSON.parse(readFileSync(join(ROOT, "vercel.json"))).headers.find((h) => h.source === "/(.*)").headers.map((h) => [h.key, h.value]);
const cspReports = []; // segnalazioni ricevute, lette dai test con /__sim/csp

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const send = (res, status, body, type = "application/json; charset=utf-8") => {
  res.writeHead(status, { ...Object.fromEntries(SECURITY), "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
// date fisse: le immagini dei test non cambiano con il giorno in cui girano
const projectRow = () => {
  const n = (c) => [...store.values()].filter((v) => v.col === c && !v.deleted).length;
  return { ...fixture.project, jira_key: store.get("meta/project")?.data?.key || "", created_at: "2026-10-16T08:00:00.000Z", updated_at: "2026-10-16T08:00:00.000Z", created_by: user.account_id, created_by_name: user.name, reqs: n("reqs"), tickets: n("tickets") };
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString();
  const p = url.pathname;
  try {
    // comandi del simulatore, usati dai test
    if (p === "/__sim/state") return send(res, 200, { issues: [...sim.issues.values()].map((i) => ({ key: i.key, type: i.type, summary: i.summary, parent: i.parent || null, labels: i.fields?.labels || [], fixVersions: (i.fields?.fixVersions || []).map((v) => v.name) })), links: sim.links || [], calls: sim.calls });
    if (p === "/__sim/reset") { sim.reset(); sim.links = []; cspReports.length = 0; api503 = 0; resetStore(url.searchParams.has("completo")); return send(res, 200, { ok: true }); }
    if (p === "/__sim/csp") return send(res, 200, { reports: cspReports });
    if (p === "/__sim/fault") {
      const b = JSON.parse(raw);
      if (b.kind === "api503") api503 = b.times; // guasto dell'API dati, non di Jira
      else { sim.faults[b.kind][b.type] = b.times; if ("retryAfter" in b) sim.retryAfter = b.retryAfter; }
      return send(res, 200, { ...sim.faults, api503 });
    }

    // API di Trama
    if (p === "/api/csp-report" && req.method === "POST") { try { cspReports.push(JSON.parse(raw)); } catch {} res.writeHead(204, Object.fromEntries(SECURITY)); return res.end(); }
    if (p === "/api/me") return send(res, 200, { ok: true, user: { accountId: user.account_id, name: user.name, email: user.email, picture: "" }, sites: user.sites });
    if (p === "/api/projects") return send(res, 200, { ok: true, projects: [projectRow()] });
    if (api503 > 0 && p.startsWith("/api/projects/") && ["PUT", "DELETE", "POST"].includes(req.method)) {
      api503--;
      return send(res, 503, { ok: false, code: "server_unavailable", message: "Servizio dati non disponibile (simulato).", retryable: true });
    }
    let m;
    if ((m = p.match(/^\/api\/projects\/([^/]+)$/)) && req.method === "GET") {
      const since = Number(url.searchParams.get("since") ? Date.parse(url.searchParams.get("since")) : 0) - 3000;
      const items = [...store.values()].filter((v) => (since > 0 ? v.at > since * 1000 : !v.deleted)).map((v) => ({ ...lighten({ col: v.col, id: v.id, data: v.deleted ? {} : v.data, deleted: v.deleted }), by: v.by || "", at: String(v.at) }));
      return send(res, 200, { ok: true, now: new Date().toISOString(), project: { id: fixture.project.id, name: fixture.project.name, cloudId: fixture.project.cloud_id, siteUrl: fixture.project.site_url, createdBy: user.account_id }, items });
    }
    if ((m = p.match(/^\/api\/projects\/([^/]+)\/items\/([^/]+)\/([^/]+)$/))) {
      const key = `${m[2]}/${decodeURIComponent(m[3])}`;
      const v = store.get(key), live = !!v && !v.deleted;
      if (req.method === "GET") {
        if (!live) return send(res, 404, { ok: false, code: "not_found", message: "Documento inesistente o eliminato." });
        return send(res, 200, { ok: true, now: nowUs(), item: { col: v.col, id: v.id, data: v.data, v: fingerprint(v.data), at: String(v.at) } });
      }
      // x-base come il server: assente = incondizionata, "none" = non esiste o è eliminato, altrimenti l'at atteso
      const base = req.headers["x-base"];
      if (base !== undefined && base !== "none" && !/^\d{1,18}$/.test(base)) return send(res, 400, { ok: false, code: "bad_request", message: "Versione di partenza (x-base) non valida." });
      const conflict = () => send(res, 409, { ok: false, code: "conflict", message: "Un collega ha appena modificato questo documento: rileggilo e riprova.", at: live ? String(v.at) : null });
      if (req.method === "PUT" && isPlaceholder(JSON.parse(raw))) return send(res, 409, { ok: false, code: "placeholder", message: "Contenuto non caricato: il documento completo non è stato sovrascritto." });
      if (req.method === "PUT") {
        if (base === "none" ? live : base !== undefined && (!live || String(v.at) !== base)) return conflict();
        const row = { col: m[2], id: decodeURIComponent(m[3]), data: JSON.parse(raw), deleted: false, at: tick(), by: req.headers["x-sim-by"] || user.account_id };
        store.set(key, row);
        return send(res, 200, { ok: true, at: String(row.at) });
      }
      if (base !== undefined && !live) return send(res, 200, { ok: true, at: v ? String(v.at) : null }); // già eliminato o mai esistito
      if (base !== undefined && (base === "none" || String(v.at) !== base)) return conflict();
      if (v) Object.assign(v, { deleted: true, data: {}, at: tick() });
      return send(res, 200, { ok: true, at: v ? String(v.at) : null });
    }
    if ((m = p.match(/^\/api\/projects\/([^/]+)\/batch$/)) && req.method === "POST") {
      const { ops } = JSON.parse(raw);
      if (ops.some((o) => isPlaceholder(o.data))) return send(res, 409, { ok: false, code: "placeholder", message: "Contenuto non caricato: il documento completo non è stato sovrascritto." });
      const saved = new Map();
      for (const o of ops) {
        const key = `${o.col}/${o.id}`;
        // come il server: un'eliminazione è un salvataggio con deleted = true, anche se l'elemento non c'era
        if (o.data === null) store.set(key, { ...store.get(key), col: o.col, id: o.id, data: {}, deleted: true, at: tick() });
        else store.set(key, { col: o.col, id: o.id, data: o.data, deleted: false, at: tick() });
        saved.set(key, { col: o.col, id: o.id, at: String(store.get(key).at) });
      }
      return send(res, 200, { ok: true, saved: ops.length, items: [...saved.values()] });
    }
    if ((m = p.match(/^\/api\/jira\/([^/]+)$/)) && req.method === "POST") {
      const op = m[1];
      if (!Object.hasOwn(ops, op)) return send(res, 200, { ok: false, code: "bad_request", message: "Operazione Jira sconosciuta." });
      try { return send(res, 200, { ok: true, payload: await ops[op](user, JSON.parse(raw || "{}")) }); }
      catch (e) { return send(res, 200, { ok: false, code: e.code || "upstream_error", message: e.message, retryable: !!e.retryable, ...(e.status ? { status: e.status } : {}) }); }
    }
    if (p.startsWith("/api/")) return send(res, 404, { ok: false, code: "not_found", message: "Percorso inesistente (simulatore)." });

    // pagine statiche
    let f = join(ROOT, "public", p === "/" ? "index.html" : p);
    if ((!existsSync(f) || statSync(f).isDirectory()) && existsSync(f + ".html")) f += ".html";
    if (existsSync(f) && statSync(f).isDirectory()) return send(res, 404, "Non trovato", "text/plain");
    if (!existsSync(f)) return send(res, 404, "Non trovato", "text/plain");
    return send(res, 200, readFileSync(f), TYPES[extname(f)] || "application/octet-stream");
  } catch (e) {
    console.log("ERRORE", p, e);
    return send(res, 500, { ok: false, message: String(e) });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Simulatore su http://127.0.0.1:${PORT}`));
