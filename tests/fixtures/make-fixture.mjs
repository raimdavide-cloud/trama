// Rigenera tests/fixtures/progetto-prova.json da un progetto vero, in sola lettura, togliendo le identità reali.
// Uso: node --env-file=.env tests/fixtures/make-fixture.mjs [id-progetto]
// Il file prodotto finisce nel repository: controlla il riepilogo prima di fare commit.
import { writeFileSync } from "node:fs";
import { sql } from "../../server/lib/core.mjs";

const id = process.argv[2] || "d703f595fa82672b87"; // «Test Prova»
const [project] = await sql`select id, name, cloud_id, site_url, created_by from projects where id = ${id}`;
if (!project) throw new Error(`Progetto ${id} non trovato`);
const items = await sql`select col, id, data from items where project_id = ${id} and not deleted`;
const users = await sql`select account_id, name, email from users`;

const FAKE = {
  cloudId: "00000000-0000-4000-8000-000000000001",
  host: "esempio.atlassian.net",
  site: "esempio",
  accountId: "account-di-prova",
  name: "Utente Prova",
  email: "utente.prova@example.com",
};

// Ogni identità reale nota diventa un valore finto (anche dentro testi e decisioni).
const host = new URL(project.site_url).host;
const pairs = [
  [project.cloud_id, FAKE.cloudId],
  [host, FAKE.host],
  [host.split(".")[0], FAKE.site],
  ...users.flatMap((u, i) => [
    [u.account_id, i ? `${FAKE.accountId}-${i}` : FAKE.accountId],
    [u.email, i ? `utente${i}@example.com` : FAKE.email],
    [u.name, i ? `Collega ${i}` : FAKE.name],
  ]),
].filter(([a]) => a && String(a).length > 3);
const scrub = (v) => {
  let s = JSON.stringify(v);
  for (const [a, b] of pairs) s = s.split(String(a)).join(b);
  return JSON.parse(s);
};

const out = {
  note: "Dati di prova anonimizzati, generati da tests/fixtures/make-fixture.mjs. Non contengono identità reali.",
  project: { id: "progetto-prova", name: project.name, cloud_id: FAKE.cloudId, site_url: `https://${FAKE.host}` },
  user: { account_id: FAKE.accountId, name: FAKE.name, email: FAKE.email, sites: [{ id: FAKE.cloudId, url: `https://${FAKE.host}`, name: FAKE.site }] },
  items: items.map((i) => ({ col: i.col, id: i.id, data: scrub(i.data) })),
};
const text = JSON.stringify(out);
const leftovers = pairs.filter(([a]) => text.includes(String(a))).length;
writeFileSync(new URL("./progetto-prova.json", import.meta.url), JSON.stringify(out, null, 1));
const byCol = out.items.reduce((m, i) => ((m[i.col] = (m[i.col] || 0) + 1), m), {});
console.log(`progetto-prova.json: ${out.items.length} elementi`, byCol, leftovers ? `ATTENZIONE: ${leftovers} identità ancora presenti` : "nessuna identità reale");
