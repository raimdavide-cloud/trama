// Operazioni Jira esposte allo strumento. I nomi e le forme delle risposte
// coincidono con quelli usati dalla pagina (gli stessi del connettore Atlassian).
import { jiraFetch, fetchSites, accessToken } from "./atlassian.mjs";

const e = encodeURIComponent;
const V3 = "/rest/api/3";
const int = (v, d, max) => Math.max(1, Math.min(Number(v) || d, max));

// Markdown dei modelli di ticket → wiki markup di Jira (API v2)
export function mdToWiki(md) {
  return String(md || "")
    .split("\n")
    .map((line) => {
      let m;
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) return `h${m[1].length}. ${m[2]}`;
      if ((m = line.match(/^(\s*)[*-]\s+(.*)$/))) return `${"*".repeat(1 + Math.floor(m[1].length / 2))} ${m[2]}`;
      if ((m = line.match(/^(\s*)\d+[.)]\s+(.*)$/))) return `${"#".repeat(1 + Math.floor(m[1].length / 2))} ${m[2]}`;
      return line;
    })
    .join("\n")
    .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
    .replace(/`([^`\n]+)`/g, "{{$1}}")
    .replace(/\[([^\]\n]+)\]\((https?:[^)\s]+)\)/g, "[$1|$2]");
}

const ALLOWED_FIELDS = /^(components|fixVersions|labels|parent|priority|customfield_\d+)$/;

export const ops = {
  async getAccessibleAtlassianResources(user) {
    return fetchSites(await accessToken(user));
  },
  async getVisibleJiraProjects(user, i) {
    const q = new URLSearchParams({
      expand: "issueTypes",
      maxResults: String(int(i.maxResults, 50, 50)),
      startAt: String(Math.max(0, Number(i.startAt) || 0)),
      action: ["view", "browse", "edit", "create"].includes(i.action) ? i.action : "create",
    });
    if (i.searchString) q.set("query", String(i.searchString).slice(0, 100));
    return jiraFetch(user, i.cloudId, `${V3}/project/search?${q}`);
  },
  async getIssueLinkTypes(user, i) {
    return jiraFetch(user, i.cloudId, `${V3}/issueLinkType`);
  },
  async getJiraIssueTypeMetaWithFields(user, i) {
    const r = await jiraFetch(
      user,
      i.cloudId,
      `${V3}/issue/createmeta/${e(i.projectIdOrKey)}/issuetypes/${e(i.issueTypeId)}?maxResults=${int(i.maxResults, 100, 200)}`,
    );
    return { fields: r.fields || r.results || r.values || [] };
  },
  async lookupJiraAccountId(user, i) {
    const r = await jiraFetch(user, i.cloudId, `${V3}/user/search?query=${e(String(i.searchString || "").slice(0, 100))}&maxResults=10`);
    return {
      users: (Array.isArray(r) ? r : [])
        .filter((u) => u.accountType === "atlassian" && u.active !== false)
        .map((u) => ({ accountId: u.accountId, displayName: u.displayName })),
    };
  },
  async searchJiraIssuesUsingJql(user, i) {
    return jiraFetch(user, i.cloudId, `${V3}/search/jql`, {
      method: "POST",
      body: {
        jql: String(i.jql || ""),
        maxResults: int(i.maxResults, 50, 100),
        fields: Array.isArray(i.fields) && i.fields.length ? i.fields.map(String) : ["summary"],
        ...(i.nextPageToken ? { nextPageToken: String(i.nextPageToken) } : {}),
      },
    });
  },
  async createJiraIssue(user, i) {
    const extra = Object.fromEntries(Object.entries(i.additional_fields || {}).filter(([k]) => ALLOWED_FIELDS.test(k)));
    const fields = {
      project: { key: String(i.projectKey) },
      issuetype: { name: String(i.issueTypeName) },
      summary: String(i.summary || "").slice(0, 255),
      ...(i.description ? { description: mdToWiki(i.description) } : {}),
      ...extra,
      ...(i.assignee_account_id ? { assignee: { accountId: String(i.assignee_account_id) } } : {}),
    };
    // API v2: la descrizione accetta il wiki markup, così i modelli restano leggibili in Jira
    return jiraFetch(user, i.cloudId, `/rest/api/2/issue`, { method: "POST", body: { fields } });
  },
  async getJiraIssue(user, i) {
    const key = String(i.issueIdOrKey || "").trim();
    if (!/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(key)) throw Object.assign(new Error("Chiave ticket non valida"), { code: "tool_error" });
    const fields = Array.isArray(i.fields) && i.fields.length ? i.fields.map(String).filter((f) => /^[A-Za-z0-9_]+$/.test(f)).join(",") : "summary,issuetype,parent,status";
    return jiraFetch(user, i.cloudId, `${V3}/issue/${e(key)}?fields=${e(fields)}`);
  },
  async setIssueParent(user, i) {
    const key = String(i.issueKey || "").trim(), parent = String(i.parentKey || "").trim();
    const ok = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
    if (!ok.test(key) || !ok.test(parent)) throw Object.assign(new Error("Chiave ticket non valida"), { code: "tool_error" });
    await jiraFetch(user, i.cloudId, `${V3}/issue/${e(key)}`, { method: "PUT", body: { fields: { parent: { key: parent } } } });
    return { ok: true };
  },
  // Cambio di release (= Fase) di un'epica: aggiorna solo label e fixVersion di un ticket già esistente.
  async setReleaseFields(user, i) {
    const key = String(i.issueKey || "").trim();
    if (!/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(key)) throw Object.assign(new Error("Chiave ticket non valida"), { code: "tool_error" });
    const labels = [...new Set((Array.isArray(i.labels) ? i.labels : []).map((l) => String(l).trim()).filter(Boolean))];
    if (labels.some((l) => /\s/.test(l) || l.length > 255)) throw Object.assign(new Error("Label non valida: niente spazi"), { code: "tool_error" });
    const fixVersions = (Array.isArray(i.fixVersions) ? i.fixVersions : []).map((v) => ({ name: String(v?.name || v).trim() })).filter((v) => v.name);
    await jiraFetch(user, i.cloudId, `${V3}/issue/${e(key)}`, { method: "PUT", body: { fields: { labels, fixVersions } } });
    return { ok: true };
  },
  async createIssueLink(user, i) {
    await jiraFetch(user, i.cloudId, `${V3}/issueLink`, {
      method: "POST",
      body: { type: { name: String(i.type) }, inwardIssue: { key: String(i.inwardIssue) }, outwardIssue: { key: String(i.outwardIssue) } },
    });
    return { ok: true };
  },
};
