// POST /api/csp-report  segnalazioni della Content-Security-Policy (vercel.json › Content-Security-Policy-Report-Only).
// Il browser le invia da solo, senza sessione: si registra una riga sintetica nei log di Vercel e si risponde 204.
// Formati accettati: report-uri ({"csp-report": {...}}) e Reporting API ([{type: "csp-violation", body: {...}}]).
const MAX_BYTES = 8_000;

const empty = (status) => new Response(null, { status, headers: { "cache-control": "no-store" } });
// solo testo breve e su una riga: i campi arrivano dal browser e finiscono nei log
const clean = (v, n = 120) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, n);
// degli indirizzi si tiene origine e percorso, mai la query (potrebbe contenere dati)
function where(u) {
  if (!u) return "";
  try { const x = new URL(u); return clean(x.protocol.startsWith("http") ? x.origin + x.pathname : x.protocol.replace(/:$/, "")); }
  catch { return clean(u, 40); }
}

export function summarize(r) {
  const directive = r["effective-directive"] || r.effectiveDirective || r["violated-directive"] || r.violatedDirective || "";
  const blocked = r["blocked-uri"] ?? r.blockedURL ?? "";
  const page = r["document-uri"] || r.documentURL || "";
  const file = r["source-file"] || r.sourceFile || "";
  const line = r["line-number"] ?? r.lineNumber ?? "";
  const mode = r.disposition || "";
  return `csp ${clean(mode, 10) || "-"} ${clean(directive, 40) || "-"} bloccato=${where(blocked) || "-"} pagina=${where(page) || "-"}` +
    (file ? ` sorgente=${where(file)}${line !== "" ? ":" + clean(line, 8) : ""}` : "");
}

export default async (req) => {
  if (req.method !== "POST") return empty(405);
  if (Number(req.headers.get("content-length") || 0) > MAX_BYTES) return empty(413);
  const text = await req.text();
  if (text.length > MAX_BYTES) return empty(413);
  let body;
  try { body = JSON.parse(text); } catch { return empty(400); }
  const reports = Array.isArray(body)
    ? body.filter((x) => x && x.type === "csp-violation" && x.body).map((x) => x.body)
    : body?.["csp-report"] ? [body["csp-report"]] : [];
  if (!reports.length) return empty(400);
  for (const r of reports.slice(0, 5)) console.log(summarize(r));
  return empty(204);
};

export const config = { path: "/api/csp-report" };
