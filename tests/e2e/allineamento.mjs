// Controlla nella pagina che ogni icona sia allineata al testo che le sta accanto.
// Un'icona è allineata se il suo centro coincide (entro la tolleranza) con il centro della prima riga di testo,
// oppure con il centro dell'intero blocco di testo (etichetta su due righe), oppure, per i riquadri icona
// grandi accanto a titolo e descrizione, se è allineata in alto. Il testo nascosto ai vedenti (sr-only) non conta.
export function misalignedIcons(tolerance = 1.5) {
  const HOSTS = ".h1-ic, .h2-ic, .sec-n, .st .n, .chat-mark, .icon-tile, .rq-qc kbd";
  const TOP_ALIGNED = ".icon-tile";
  const hiddenEl = (el) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.display === "none" || s.visibility === "hidden" || e.hidden) return true;
      const r = e.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1 || (s.position === "absolute" && s.clip !== "auto")) return true;
      if (e.tagName === "DETAILS" && !e.open && !el.closest("summary")) return true;
    }
    return false;
  };
  const textRects = (root, skip) => {
    const out = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() && !skip.contains(n) && !hiddenEl(n.parentElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
    for (let n = w.nextNode(); n; n = w.nextNode()) { const rg = document.createRange(); rg.selectNodeContents(n); for (const r of rg.getClientRects()) if (r.width > 0) out.push({ r, n }); }
    return out;
  };
  const res = [], seen = new Set();
  for (const ic of document.querySelectorAll(`svg.ic, ${HOSTS}`)) {
    const host = ic.closest(HOSTS) || ic;
    if (seen.has(host) || hiddenEl(host)) continue;
    seen.add(host);
    const ir = host.getBoundingClientRect(), icy = ir.top + ir.height / 2;
    let best = null, scope = host.parentElement;
    for (let up = 0; scope && up < 3 && !best; up++, scope = up < 3 ? scope.parentElement : scope) {
      for (const t of textRects(scope, host)) {
        const r = t.r, overlap = Math.min(r.bottom, ir.bottom) - Math.max(r.top, ir.top);
        const gap = r.left >= ir.right ? r.left - ir.right : ir.left >= r.right ? ir.left - r.right : 0;
        if (overlap > Math.min(r.height, ir.height) * 0.3 && gap < 24 && (!best || gap < best.gap || (gap === best.gap && r.top < best.r.top))) best = { ...t, gap, scope };
      }
    }
    if (!best) continue;
    // blocco di testo: l'elemento accanto all'icona che contiene la riga trovata
    let block = best.n.parentElement;
    while (block.parentElement && block.parentElement !== best.scope && !block.parentElement.contains(host)) block = block.parentElement;
    const rs = textRects(block, host).map((t) => t.r).filter((r) => Math.abs(r.left - best.r.left) < 400);
    const top = Math.min(...rs.map((r) => r.top)), bottom = Math.max(...rs.map((r) => r.bottom));
    const line = best.r.top + best.r.height / 2 - icy, whole = (top + bottom) / 2 - icy;
    const ok = Math.abs(line) <= tolerance || Math.abs(whole) <= tolerance || (host.matches(TOP_ALIGNED) && Math.abs(top - ir.top) <= 12);
    if (!ok) res.push({ icona: (host.getAttribute("class") || host.tagName.toLowerCase()).split(" ")[0], testo: best.n.textContent.trim().slice(0, 40), scarto: Math.round(line * 10) / 10 });
  }
  return res;
}
