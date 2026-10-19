// Cosa NON è testo dell'interfaccia: dati del progetto di prova, nomi letti da Jira, titoli dei ticket, sigle.
// Lo usano il raccoglitore (npm run i18n:mancanti) e il test di copertura dell'inglese.
import { readFileSync } from "node:fs";

export const norm = (s) => s.replace(/«[^«»]*»/g, "«{q}»").replace(/\b[A-Z][A-Z0-9]*-\d+\b/g, "{k}").replace(/\d+(?:[.,:/]\d+)*/g, "{n}");

export function datiDiProva() {
  const fixture = JSON.parse(readFileSync(new URL("../../tests/fixtures/progetto-prova.json", import.meta.url)));
  const data = new Set();
  (function walk(v) { if (typeof v === "string") { data.add(v.trim()); v.split(/\n+/).forEach((l) => data.add(l.trim())); } else if (v && typeof v === "object") Object.values(v).forEach(walk); })(fixture);
  return data;
}

const IGNORA = new Set(["Logic", "Manual_Test", "UP", "esempio.atlassian.net", "To Do", "rama", "iOS", "Android", "UI", "ticket", "Trama", "Utente Prova", "utente.prova@example.com", "OrtoComune", "ORTO"]);

export function isData(s, data, dataN = (data.__n ??= new Set([...data].map(norm)))) {
  const k = norm(s), core = k.replace(/^\{k\}:? /, "").replace(/ \(\{n\}\)$/, "");
  return data.has(s) || dataN.has(k) || dataN.has(core) || IGNORA.has(s) || IGNORA.has(k.replace(/ · \{n\}$/, ""))
    || /^\[[^\]]+\]/.test(s) || /^[a-z_]+: .* → /.test(s) || /^https?:\/\//.test(s) || /\(.+ \/ .+\)$/.test(s) || / · Trama$/.test(s) || /^[A-Z][A-Z0-9]*-\d+$/.test(s)
    || /^((Web|Mobile|BE|FW|UX Story|Story|Feature Epic|Project|Fase|Epic|Task|Bug|Release|Action item|AgileTest|AgileTest Defect)( · |, )?)+$/.test(s);
}
