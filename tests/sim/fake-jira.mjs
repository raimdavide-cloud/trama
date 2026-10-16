// Jira Cloud finto, in memoria: sostituisce fetch verso api.atlassian.com.
// Rispetta le regole che contano per la struttura Cliente → Project → Fase → Epica → ticket:
//  - il tipo deve esistere nel progetto
//  - il padre deve esistere e stare esattamente un livello sopra (Project 3 > Fase 2 > Epica 1 > ticket 0)
//  - le ricerche JQL falliscono se una chiave non esiste (come Jira vero)
const realFetch = globalThis.fetch;

export const sim = {
  projectKey: "COM",
  cloudId: "00000000-0000-4000-8000-000000000001",
  types: [],
  components: [],
  versions: [],
  issues: new Map(),
  counter: 1000,
  calls: [],
  faults: { afterCreate500: {}, before500: {} }, // per tipo: quante volte fallire
  reset() { this.issues.clear(); this.counter = 1000; this.calls = []; this.faults = { afterCreate500: {}, before500: {} }; },
};

const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const err = (status, errors = {}, errorMessages = []) => json(status, { errorMessages, errors });
const typeByName = (n) => sim.types.find((t) => t.name === n);
const level = (issue) => typeByName(issue.type)?.level ?? 0;
const now = () => new Date().toISOString();

function view(issue, wanted) {
  const all = {
    summary: issue.summary,
    issuetype: { id: typeByName(issue.type)?.id, name: issue.type, hierarchyLevel: level(issue), subtask: false },
    status: { name: "To Do" },
    labels: issue.fields.labels || [],
    components: issue.fields.components || [],
    fixVersions: issue.fields.fixVersions || [],
    description: issue.description || null,
    created: issue.created,
    parent: issue.parent ? { key: issue.parent, fields: { summary: sim.issues.get(issue.parent)?.summary } } : undefined,
  };
  const fields = {};
  for (const f of wanted) if (all[f] !== undefined) fields[f] = all[f];
  return { id: String(issue.id), key: issue.key, fields };
}

function checkParent(childType, parentKey) {
  const parent = sim.issues.get(parentKey);
  if (!parent) return err(400, { parent: `Il ticket padre ${parentKey} non esiste.` });
  const want = (typeByName(childType)?.level ?? 0) + 1;
  if (level(parent) !== want) {
    return err(400, { parent: `Un ticket di tipo «${childType}» (livello ${want - 1}) non può stare sotto «${parent.type}» (livello ${level(parent)}): serve un padre di livello ${want}.` });
  }
  return null;
}

function runJql(jql, body) {
  const [where] = jql.split(/\s+ORDER BY\s+/i);
  let list = [...sim.issues.values()];
  for (const clause of where.split(/\s+AND\s+/i).map((c) => c.trim()).filter(Boolean)) {
    let m;
    if ((m = clause.match(/^project\s*=\s*"?([A-Za-z0-9_]+)"?$/i))) list = list.filter(() => m[1] === sim.projectKey);
    else if ((m = clause.match(/^issuetype\s*=\s*"(.+)"$/i))) list = list.filter((i) => i.type === m[1]);
    else if ((m = clause.match(/^summary\s*~\s*"(.*)"$/i))) {
      const words = m[1].toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter((i) => words.every((w) => i.summary.toLowerCase().includes(w)));
    } else if ((m = clause.match(/^created\s*>=\s*-(\d+)m$/i))) list = list.filter((i) => Date.now() - Date.parse(i.created) <= Number(m[1]) * 60000);
    else if ((m = clause.match(/^parent\s*=\s*"?([A-Z0-9-]+)"?$/i))) list = list.filter((i) => i.parent === m[1]);
    else if ((m = clause.match(/^key\s+in\s*\((.*)\)$/i))) {
      const keys = m[1].split(",").map((k) => k.trim());
      const missing = keys.find((k) => !sim.issues.has(k));
      if (missing) return err(400, {}, [`An issue with key '${missing}' does not exist for field 'key'.`]);
      list = list.filter((i) => keys.includes(i.key));
    } else return err(400, {}, [`SIMULATORE: clausola JQL non gestita: ${clause}`]);
  }
  if (/ORDER BY\s+created\s+DESC/i.test(jql)) list.sort((a, b) => b.id - a.id);
  const wanted = body.fields || ["summary"];
  return json(200, { issues: list.slice(0, body.maxResults || 50).map((i) => view(i, wanted)), isLast: true });
}

async function handle(url, init) {
  const u = new URL(url);
  const method = (init.method || "GET").toUpperCase();
  const body = init.body ? JSON.parse(init.body) : {};
  if (u.pathname === "/oauth/token/accessible-resources") return json(200, [{ id: sim.cloudId, url: "https://esempio.atlassian.net", name: "esempio" }]);
  const p = u.pathname.replace(/^\/ex\/jira\/[^/]+/, "");
  sim.calls.push(`${method} ${p}${body.fields?.issuetype ? " [" + body.fields.issuetype.name + "]" : ""}`);

  if (method === "POST" && p === "/rest/api/2/issue") {
    const f = body.fields || {};
    if (f.project?.key !== sim.projectKey) return err(400, { project: "Progetto inesistente." });
    if (!typeByName(f.issuetype?.name)) return err(400, { issuetype: "Specificare un tipo di ticket valido." });
    if (!f.summary) return err(400, { summary: "Il riepilogo è obbligatorio." });
    for (const c of f.components || []) if (!sim.components.includes(c.name)) return err(400, { components: `Componente «${c.name}» inesistente.` });
    for (const v of f.fixVersions || []) if (!sim.versions.includes(v.name)) return err(400, { fixVersions: `Versione «${v.name}» inesistente.` });
    if (f.parent?.key) { const bad = checkParent(f.issuetype.name, f.parent.key); if (bad) return bad; }
    const t = f.issuetype.name;
    if ((sim.faults.before500[t] || 0) > 0) { sim.faults.before500[t]--; return err(500, {}, ["Errore interno simulato (prima della creazione)"]); }
    const id = ++sim.counter;
    const issue = { id, key: `${sim.projectKey}-${id}`, type: t, summary: f.summary, description: f.description, parent: f.parent?.key, fields: f, created: now() };
    sim.issues.set(issue.key, issue);
    if ((sim.faults.afterCreate500[t] || 0) > 0) { sim.faults.afterCreate500[t]--; return err(500, {}, ["Timeout simulato: il ticket è stato creato ma la risposta si è persa"]); }
    return json(201, { id: String(id), key: issue.key, self: `https://x/rest/api/2/issue/${id}` });
  }
  let m;
  if ((m = p.match(/^\/rest\/api\/3\/issue\/([A-Z0-9-]+)$/))) {
    const issue = sim.issues.get(m[1]);
    if (!issue) return err(404, {}, ["Issue does not exist or you do not have permission to see it."]);
    if (method === "GET") return json(200, view(issue, (u.searchParams.get("fields") || "summary").split(",")));
    if (method === "PUT") {
      const parent = body.fields?.parent?.key;
      if (parent) { const bad = checkParent(issue.type, parent); if (bad) return bad; issue.parent = parent; }
      return new Response(null, { status: 204 });
    }
  }
  if (method === "POST" && p === "/rest/api/3/search/jql") return runJql(body.jql || "", body);
  if (method === "GET" && p === "/rest/api/3/project/search") {
    return json(200, { values: [{ id: "12422", key: sim.projectKey, name: "Compass", issueTypes: sim.types.map((t) => ({ id: t.id, name: t.name, subtask: false, hierarchyLevel: t.level })) }], isLast: true });
  }
  if (method === "GET" && p === "/rest/api/3/issueLinkType") {
    return json(200, { issueLinkTypes: [{ name: "1. Relates", inward: "relates to", outward: "relates to" }, { name: "3. Blocking", inward: "is blocked by", outward: "blocks" }] });
  }
  if (method === "GET" && /\/issue\/createmeta\//.test(p)) return json(200, { fields: [{ fieldId: "components", name: "Components", required: false, allowedValues: sim.components.map((name, i) => ({ id: String(i), name })) }, { fieldId: "fixVersions", name: "Fix versions", required: false, allowedValues: sim.versions.map((name, i) => ({ id: String(i), name })) }] });
  if (method === "POST" && p === "/rest/api/3/issueLink") {
    const a = sim.issues.get(body.inwardIssue?.key), b = sim.issues.get(body.outwardIssue?.key);
    if (!a || !b) return err(404, {}, ["Ticket da collegare inesistente."]);
    (sim.links ??= []).push({ type: body.type?.name, from: a.key, to: b.key });
    return new Response(null, { status: 201 });
  }
  if (method === "GET" && p === "/rest/api/3/user/search") return json(200, []);
  return err(404, {}, [`SIMULATORE: percorso non gestito: ${method} ${p}`]);
}

globalThis.fetch = async (url, init = {}) => {
  if (!String(url).startsWith("https://api.atlassian.com/")) return realFetch(url, init);
  return handle(url, init);
};
