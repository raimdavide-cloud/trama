/* Lingua dell'interfaccia di Trama: italiano (la lingua del codice) o inglese.
   I testi restano scritti in italiano nel codice; in inglese un osservatore del DOM li sostituisce con il dizionario
   di i18n-en.js, cercando prima il testo esatto e poi il modello con numeri ({n}), nomi tra «» ({q}) e chiavi ({k}).
   I dati del progetto (requisiti, ticket, decisioni, documenti, messaggi della chat) non si traducono: si salta tutto
   ciò che sta dentro [data-no-i18n], campi di testo e codice. Per controllare la copertura: window.I18N.missing. */
(() => {
  const KEY = "trama:lang";
  const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const lang = read() === "en" ? "en" : "it";
  const dict = (lang === "en" && window.TRAMA_EN) || { exact: {}, templates: {}, wild: {} };
  const ATTRS = ["placeholder", "aria-label", "title", "alt", "data-tip"];
  const SKIP = "script,style,textarea,input,code,pre,[contenteditable],[data-no-i18n]";
  const missing = new Set();
  const done = new Set(); // testi già tradotti: l'osservatore li rivede, ma non sono testi mancanti

  // «Diario colturale» → «{q}», RF-012 / COM-1001 / T-051 → {k}, 3 / 10:42 / 16/10/2026 / 1,5 → {n}
  const TOKENS = /«[^«»]*»|\b[A-Z][A-Z0-9]*-\d+\b|\d+(?:[.,:/]\d+)*/g;
  function normalize(s) {
    const vals = { n: [], q: [], k: [] };
    const key = s.replace(TOKENS, (m) => {
      if (m.startsWith("«")) { vals.q.push(m.slice(1, -1)); return "«{q}»"; }
      if (/^[A-Z]/.test(m)) { vals.k.push(m); return "{k}"; }
      vals.n.push(m); return "{n}";
    });
    return { key, vals };
  }
  // nel testo inglese {n}, {q}, {k} si consumano in ordine; {n2}, {q1}… scelgono la posizione
  function fill(tpl, vals) {
    const used = { n: 0, q: 0, k: 0 };
    return tpl.replace(/\{([nqk])(\d*)\}/g, (_, t, i) => (i ? vals[t][Number(i) - 1] : vals[t][used[t]++]) ?? "");
  }
  // modelli con {*} (testo libero: un nome, un elenco, una data relativa), anche insieme a {n}, {q}, {k}:
  // diventano espressioni regolari; il testo libero catturato si traduce a sua volta se possibile
  const GROUP = { n: "(\\d+(?:[.,:/]\\d+)*)", q: "«([^«»]*)»", k: "(\\b[A-Z][A-Z0-9]*-\\d+\\b)", "*": "(.+?)" };
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [...Object.entries(dict.templates || {}), ...Object.entries(dict.wild || {})]
    .filter(([k]) => k.includes("{*}"))
    .map(([k, v]) => {
      const types = [];
      const src = k.split(/(«\{q\}»|\{[nqk*]\})/).map((part) => {
        const m = part.match(/^«?\{([nqk*])\}»?$/);
        if (!m) return esc(part);
        types.push(m[1]);
        return GROUP[m[1]];
      }).join("");
      return { re: new RegExp("^" + src + "$"), types, v, strict: /^[{}*\s;,·:]+$/.test(k) }; // solo separatori: vale se ogni pezzo è tradotto
    });
  function one(core) {
    const ex = dict.exact[core];
    if (ex !== undefined) return ex;
    const { key, vals } = normalize(core);
    if (dict.templates[key] !== undefined && !key.includes("{*}")) return fill(dict.templates[key], vals);
    for (const p of patterns) {
      const m = core.match(p.re);
      if (!m) continue;
      const got = { n: [], q: [], k: [], "*": [] };
      let ok = true;
      p.types.forEach((ty, i) => { if (ty !== "*") return got[ty].push(m[i + 1]); const tr = one(m[i + 1]); if (tr === undefined) ok = false; got[ty].push(tr ?? m[i + 1]); });
      if (p.strict && !ok) continue;
      const used = { n: 0, q: 0, k: 0, "*": 0 };
      return p.v.replace(/\{([nqk*])(\d*)\}/g, (_, ty, i) => (i ? got[ty][Number(i) - 1] : got[ty][used[ty]++]) ?? "");
    }
    return undefined;
  }
  function t(s) {
    if (lang !== "en" || !s) return s;
    if (s.includes("\n")) return s.split("\n").map(t).join("\n"); // log su più righe: una riga alla volta
    const core = s.trim();
    if (!core || !/[a-zàèéìòù]{2}/i.test(core)) return s;
    const time = core.match(/^(\d{1,2}:\d{2}(?::\d{2})?\s+)(.+)$/); // «10:42  Inizio creazione.»
    if (time) { if (done.has(time[2])) return s; const r = one(time[2]); if (r !== undefined) { done.add(r.trim()); return s.replace(core, time[1] + r); } }
    if (done.has(core)) return s;
    const out = one(core);
    if (out === undefined) { missing.add(core); return s; }
    done.add(out.trim());
    return s.replace(core, out);
  }
  const skipped = (el) => !el || el.closest?.(SKIP);
  function translateAttrs(el) {
    for (const a of ATTRS) if (el.hasAttribute(a)) { const v = el.getAttribute(a), tv = t(v); if (tv !== v) el.setAttribute(a, tv); }
  }
  function translateTree(root) {
    if (lang !== "en" || !root) return;
    if (root.nodeType === 3) { if (!skipped(root.parentElement)) { const v = t(root.nodeValue); if (v !== root.nodeValue) root.nodeValue = v; } return; }
    if (root.nodeType !== 1 || root.closest("[data-no-i18n],[contenteditable]")) return;
    if (root.matches(SKIP)) { translateAttrs(root); return; }
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => (n.nodeType === 1 ? (n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP) : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = w.nextNode(); n; n = w.nextNode()) { const v = t(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; }
    // gli attributi (segnaposto, etichette) si traducono anche nei campi di testo: resta escluso solo ciò che è dato
    const els = [root, ...root.querySelectorAll("[" + ATTRS.join("],[") + "]")];
    for (const el of els) {
      if (el.nodeType !== 1 || el.closest("[data-no-i18n],[contenteditable]")) continue;
      translateAttrs(el);
    }
  }

  window.I18N = {
    lang,
    locale: () => (lang === "en" ? "en-GB" : "it-IT"),
    t,
    missing,
    translate: translateTree,
    set(l) { try { localStorage.setItem(KEY, l); } catch {} },
  };
  document.documentElement.lang = lang;
  const mark = () => document.querySelectorAll("[data-lang][role=menuitemradio]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.lang === lang)));
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", mark) : mark();
  if (lang !== "en") return;
  const start = () => {
    translateTree(document.body);
    document.title = t(document.title);
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === "childList") m.addedNodes.forEach(translateTree);
        else if (m.type === "characterData") translateTree(m.target);
        else if (m.type === "attributes") translateTree(m.target);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    new MutationObserver(() => { const v = t(document.title); if (v !== document.title) document.title = v; }).observe(document.querySelector("title"), { childList: true });
  };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", start) : start();
})();
