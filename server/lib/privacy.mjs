// Atlassian Personal Data Reporting API: segnala gli account per cui Trama conserva dati personali
// e applica le risposte (closed → cancella, updated → rilegge nome ed email).
// https://developer.atlassian.com/cloud/jira/platform/user-privacy-developer-guide/
import { env, sql } from "./core.mjs";
import { accessToken } from "./atlassian.mjs";

const REPORT_URL = "https://api.atlassian.com/app/report-accounts/";
const BATCH = 90;
const DEFAULT_CYCLE_DAYS = 7;

async function getSetting(key) {
  const r = await sql`select value from app_settings where key = ${key}`;
  return r[0]?.value ?? null;
}
async function setSetting(key, value) {
  await sql`insert into app_settings (key, value, updated_at) values (${key}, ${String(value)}, now())
            on conflict (key) do update set value = excluded.value, updated_at = now()`;
}

// Atlassian consiglia il token dell'account proprietario dell'app; in mancanza si usa l'utente più recente.
async function reporter() {
  const owner = env("PRIVACY_REPORTER_ACCOUNT_ID");
  const rows = owner
    ? await sql`select * from users where account_id = ${owner} and refresh_token is not null`
    : await sql`select * from users where refresh_token is not null order by updated_at desc limit 1`;
  return rows[0] || null;
}

// Cancella i dati personali di un account chiuso. I progetti restano: perdono solo il riferimento all'autore.
export async function erasePerson(accountId) {
  await sql`update items set updated_by = null where updated_by = ${accountId}`;
  await sql`delete from items where col = 'presence' and id = ${presenceId(accountId)}`; // il nome mostrato ai colleghi
  await sql`update projects set created_by = null where created_by = ${accountId}`;
  await sql`delete from users where account_id = ${accountId}`; // le sessioni si cancellano a cascata
}

async function refreshPerson(rep, accountId) {
  const site = (rep.sites || [])[0];
  if (!site) return false;
  const token = await accessToken(rep);
  const r = await fetch(`https://api.atlassian.com/ex/jira/${encodeURIComponent(site.id)}/rest/api/3/user?accountId=${encodeURIComponent(accountId)}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (r.status === 404) { await erasePerson(accountId); return true; }
  if (!r.ok) return false;
  const u = await r.json();
  await sql`update users set name = ${u.displayName || ""}, email = ${u.emailAddress || ""}, picture = ${u.avatarUrls?.["48x48"] || ""},
              data_updated_at = now() where account_id = ${accountId}`;
  return true;
}

export async function runPrivacyReport({ force = false } = {}) {
  const cycleDays = Number(await getSetting("privacy_cycle_days")) || DEFAULT_CYCLE_DAYS;
  const due = force
    ? await sql`select account_id, coalesce(data_updated_at, updated_at, created_at) as at from users`
    : await sql`select account_id, coalesce(data_updated_at, updated_at, created_at) as at from users
                where reported_at is null or reported_at < now() - make_interval(days => ${cycleDays})`;
  const result = { reported: 0, closed: 0, updated: 0, skipped: false, cycleDays };
  if (!due.length) return result;
  const rep = await reporter();
  if (!rep) return { ...result, skipped: "nessun token disponibile" };

  for (let i = 0; i < due.length; i += BATCH) {
    const part = due.slice(i, i + BATCH).filter((u) => u.account_id && u.account_id !== "unknown");
    const body = { accounts: part.map((u) => ({ accountId: u.account_id, updatedAt: new Date(u.at).toISOString() })) };
    const token = await accessToken(rep);
    const r = await fetch(REPORT_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    const cycle = r.headers.get("cycle-period");
    if (cycle && Number(cycle) > 0) {
      // L'unità non è garantita: valori grandi sono secondi, valori piccoli giorni. Mai sotto 1 giorno.
      const v = Number(cycle);
      const days = Math.max(1, Math.round(v >= 1000 ? v / 86400 : v));
      await setSetting("privacy_cycle_days", days);
      result.cycleDays = days;
    }
    if (r.status === 429) return { ...result, skipped: `limite di richieste, riprovo tra ${r.headers.get("retry-after") || "?"} s` };
    if (r.status !== 200 && r.status !== 204) {
      const text = await r.text().catch(() => "");
      throw new Error(`Report accounts ${r.status}: ${text.slice(0, 200)}`);
    }
    if (r.status === 200) {
      const data = await r.json().catch(() => ({ accounts: [] }));
      for (const a of data.accounts || []) {
        if (a.status === "closed") { await erasePerson(a.accountId); result.closed++; }
        else if (a.status === "updated") { if (await refreshPerson(rep, a.accountId)) result.updated++; }
      }
    }
    const ids = part.map((u) => u.account_id);
    await sql`update users set reported_at = now() where account_id = any(${ids})`;
    result.reported += part.length;
  }
  return result;
}

// identificativo della riga di presenza di un account (gli ID Atlassian possono contenere «:»); uguale nella pagina
export const presenceId = (accountId) => String(accountId || "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
