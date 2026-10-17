// Apertura leggera: i contenuti pesanti non viaggiano con lo stato del progetto (snapshot e delta),
// ma si caricano uno alla volta quando servono (GET /api/projects/:id/items/:col/:item).
//  - docs/*        il testo del documento (fino a 110.000 caratteri): restano nome, tipo, caratteri, data
//  - meta/runlog   il log dell'ultima creazione in Jira: restano data e numero di righe
//  - meta/quality  le segnalazioni del controllo di qualità: restano data e conteggi
// Al posto del contenuto arriva `_lazy: {len, v}`: lunghezza e versione (impronta del contenuto completo).
// Lo stesso codice gira nel server e nel simulatore dei test; il browser calcola la stessa impronta (studio-runtime.js).
export const LAZY_META = new Set(["runlog", "quality"]);
export const isLazyItem = (col, id) => col === "docs" || (col === "meta" && LAZY_META.has(id));
export const isPlaceholder = (data) => !!data && typeof data === "object" && Object.hasOwn(data, "_lazy");

// JSON con le chiavi in ordine: Postgres (JSONB) riordina le chiavi, l'impronta non deve cambiare per questo
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : canonical(x))).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}
// FNV-1a a 32 bit sulle unità UTF-16: veloce, uguale nel browser; basta a dire «è cambiato»
export function fingerprint(data) {
  const s = canonical(data);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + "-" + s.length.toString(36);
}

export function placeholder(col, id, data) {
  if (!data || typeof data !== "object" || isPlaceholder(data)) return data;
  const v = fingerprint(data);
  if (col === "docs") {
    const { text, ...rest } = data;
    return { ...rest, _lazy: { len: String(text ?? "").length, v } };
  }
  if (id === "runlog") return { at: data.at, n: (data.lines || []).length, _lazy: { len: canonical(data).length, v } };
  if (id === "quality") {
    const f = Array.isArray(data.findings) ? data.findings : [];
    const open = f.filter((x) => x?.status === "open");
    return { at: data.at, count: data.count, sum: { n: f.length, open: open.length, high: open.filter((x) => x?.severity === "high").length }, _lazy: { len: canonical(data).length, v } };
  }
  return data;
}

// un elemento dello stato del progetto ({col, id, data, deleted}) nella forma leggera
export const lighten = (it) => (!it.deleted && isLazyItem(it.col, it.id) && it.data && Object.keys(it.data).length ? { ...it, data: placeholder(it.col, it.id, it.data) } : it);
