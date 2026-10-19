// Runtime di Trama sul sito: dati condivisi (Postgres), Jira (OAuth Atlassian) e Claude (API Anthropic).
// Espone le stesse interfacce usate dallo strumento: DB (doc/collection/onSnapshot), MCP.callTool, sample().
(() => {
  const BS = (window.BS = {});

  async function api(path, { method = "GET", body, signal, headers } = {}) {
    let r;
    try {
      r = await fetch(path, {
        method,
        credentials: "same-origin",
        headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (e) {
      throw { code: signal?.aborted ? "cancelled" : "server_unavailable", message: "Connessione non riuscita: controlla la rete e riprova.", retryable: true };
    }
    let data = {};
    try { data = await r.json(); } catch {}
    if (r.status === 401) {
      BS.onUnauthenticated?.(data.code);
      throw { code: data.code === "needs_reauth" ? "needs_reauth" : "unauthenticated", message: data.message || "Sessione scaduta: accedi di nuovo con Atlassian." };
    }
    if (!r.ok || data.ok === false) {
      throw { code: data.code || "upstream_error", message: data.message || `HTTP ${r.status}`, retryable: !!data.retryable, status: r.status, ...("at" in data ? { at: data.at } : {}), ...(data.status != null ? { jiraStatus: data.status } : {}) }; // jiraStatus: lo status di Jira dietro /api/jira
    }
    return data;
  }
  BS.api = api;

  // Apertura leggera: testo dei documenti, log e controllo di qualità arrivano come segnaposto {…, _lazy: {len, v}}
  // e si caricano con db.load(col, id). v è l'impronta del contenuto completo, calcolata come in server/lib/lazy.mjs.
  BS.isLazy = (d) => !!d && typeof d === "object" && Object.hasOwn(d, "_lazy");
  const canonical = (v) =>
    Array.isArray(v) ? `[${v.map((x) => (x === undefined ? "null" : canonical(x))).join(",")}]`
    : v && typeof v === "object" ? `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`
    : JSON.stringify(v) ?? "null";
  BS.fingerprint = (data) => {
    const s = canonical(data);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36) + "-" + s.length.toString(36);
  };

  /* ---------- dati condivisi: stessa forma del db degli artifact ---------- */
  // Una scrittura può essere un contenuto (null = elimina) o una funzione di modifica fresh => nuovo, che si riapplica
  // sui dati freschi se un collega ha salvato prima. Esiti della funzione: null = annullata (l'elemento non c'è più
  // com'era), BS.DEL = elimina, undefined o lo stesso contenuto = niente da salvare.
  BS.DEL = Symbol("elimina");
  BS.GONE = Symbol("annullata");
  BS.SAME = Symbol("invariata");
  BS.change = (fn, base) => {
    const r = fn(base === undefined ? undefined : structuredClone(base));
    if (r === null) return BS.GONE;
    if (r === undefined) return BS.SAME;
    const v = r === BS.DEL ? undefined : r;
    return JSON.stringify(v) === JSON.stringify(base) ? BS.SAME : v;
  };
  BS.createDB = (pid, initial) => {
    const store = {};
    const subs = {};
    const pending = new Map(); // elemento → scritture chieste e non ancora concluse
    // versione di ogni elemento come la conosce il server (at della riga, viva o eliminata): è la base (x-base) delle scritture condizionali
    const ver = new Map();
    const mark = (k, at, live) => ver.set(k, { at: at == null ? (ver.get(k)?.at ?? 0) : Number(at), live });
    // la risposta di una scrittura non abbassa mai la versione: se la sincronizzazione ne ha già portata una più recente (un collega
    // ha salvato subito dopo), resta quella, con i suoi dati
    const raise = (k, at, live) => { const v = ver.get(k); if (v && at != null && Number(at) < v.at) return false; mark(k, at, live); return true; };
    const baseOf = (k) => (ver.get(k)?.live ? String(ver.get(k).at) : "none");
    let since = initial.now;
    if (initial.now) BS.onClock?.(Date.parse(initial.now) * 1000);
    for (const it of initial.items) { (store[it.col] ||= {})[it.id] = it.data; if (it.at != null) mark(`${it.col}/${it.id}`, it.at, true); }
    const snap = (c) => ({ docs: Object.entries(store[c] || {}).map(([id, d]) => ({ id, exists: true, data: () => d })) });
    const notify = (c) => (subs[c] || []).forEach((f) => { try { f(snap(c)); } catch (e) { console.error(e); } });
    const get = (c, id) => store[c]?.[id];
    const apply = (c, id, data) => {
      if (data == null) delete (store[c] || {})[id];
      else (store[c] ||= {})[id] = data;
    };
    const url = (c, id) => `/api/projects/${encodeURIComponent(pid)}/items/${c}/${encodeURIComponent(id)}`;
    // Salvataggi, nell'ordine in cui sono stati chiesti. Quelli senza controllo chiesti nello stesso momento (per esempio i
    // requisiti di una release rinominata) partono insieme in una sola richiesta. Quelli condizionali partono uno per uno con la
    // base letta all'invio, fino a 4 insieme su elementi diversi; due scritture sullo stesso elemento non si sovrappongono mai.
    // Il contenuto in store è già quello delle scritture in attesa; known tiene l'ultimo confermato dal server.
    const MAX_OPS = 500, MAX_BYTES = 3_500_000, PAR = 4, WAITS = [2000, 5000, 10000, 20000, 30000];
    const outbox = [];
    const known = new Map();
    let flight = [], flushTimer = null, pumping = false, retrying = false, fails = 0;
    const writeErr = (e) => ({
      code: e.code === "conflict" || e.code === "gone" ? e.code : e.code === "too_large" ? "quota_exceeded" : e.code === "unauthenticated" || e.code === "needs_reauth" || e.code === "not_found" ? "revoked" : "unavailable",
      message: e.message,
    });
    const retryable = (e) => !!e && e.code !== "cancelled" && (!!e.retryable || e.status >= 500 || e.status === 429 || ["server_unavailable", "unavailable", "resource_exhausted", "rate_limited"].includes(e.code));
    const GIVE_UP = 10 * 60_000; // dopo 10 minuti di ritentativi una scrittura si dà per non riuscita
    const report = () => BS.onPending?.(retrying ? outbox.length + flight.length : 0);
    function write(c, id, v, o = {}) {
      const k = `${c}/${id}`, fn = typeof v === "function" ? v : null, cur = get(c, id);
      let data = v;
      if (fn) {
        data = BS.change(fn, cur);
        if (data === BS.GONE) return settled(cur, { code: "gone" });
        if (data === BS.SAME) return settled(cur);
      }
      data ??= null;
      // un segnaposto non parte mai: sovrascriverebbe il contenuto completo (anche il server lo rifiuta)
      if (BS.isLazy(data)) return { ...settled(cur, { code: "placeholder", message: "Contenuto non ancora caricato: nulla è stato salvato." }), value: data };
      if (!pending.has(k)) known.set(k, cur);
      pending.set(k, (pending.get(k) || 0) + 1);
      apply(c, id, data);
      touch();
      const op = { c, id, k, fn, data, from: cur, cond: !!o.cond, base: o.base, tries: 0, size: data === null ? 0 : JSON.stringify(data).length };
      const accepted = new Promise((res, rej) => { op.ok = res; op.no = rej; });
      const done = new Promise((res, rej) => { op.res = res; op.rej = rej; });
      accepted.catch(() => {}); done.catch(() => {});
      outbox.push(op);
      if (retrying) { op.ok(); report(); } // c'è già un ritentativo in corso: la scrittura è in coda e partirà dopo
      flushTimer ??= setTimeout(flush, 0);
      return { value: data ?? undefined, accepted, done };
    }
    function settled(value, err) {
      const p = err ? Promise.reject(err) : Promise.resolve();
      p.catch(() => {});
      return { value, same: !err, gone: err?.code === "gone", accepted: p, done: p };
    }
    // la funzione di modifica sui dati di partenza: annullata, invariata o con il nuovo contenuto
    function recompute(op, base) {
      let d;
      try { d = BS.change(op.fn, base); } catch (e) { console.warn(e); d = BS.GONE; } // non si applica ai dati freschi
      op.from = base;
      op.gone = d === BS.GONE;
      op.same = d === BS.SAME;
      op.data = op.gone || op.same ? base ?? null : d ?? null;
      op.redo = true;
    }
    // ricalcola il contenuto locale: l'ultimo confermato più le scritture ancora in attesa, nell'ordine
    function refold(c, id) {
      const k = `${c}/${id}`;
      let acc = known.get(k);
      for (const op of [...flight, ...outbox]) {
        if (op.k !== k || op.dead) continue;
        if (op.cond && op.fn && op.from !== acc) recompute(op, acc);
        if (op.cond && (op.gone || op.same)) continue;
        acc = op.data ?? undefined;
      }
      const before = get(c, id);
      apply(c, id, acc);
      if (JSON.stringify(before) !== JSON.stringify(acc)) notify(c);
    }
    function finish(op) {
      op.finished = true;
      const n = pending.get(op.k) - 1;
      if (n) pending.set(op.k, n);
      else { pending.delete(op.k); known.delete(op.k); }
    }
    function done(op) {
      if (!op.stale) known.set(op.k, op.data ?? undefined);
      op.dead = true; // conclusa: il suo contenuto è ora in known e non va riapplicato
      if (op.redo || op.stale) refold(op.c, op.id);
      finish(op);
      op.ok(); op.res(op.at); // done si risolve con la versione scritta
    }
    function fail(op, e) {
      const err = writeErr(e);
      op.dead = true;
      refold(op.c, op.id);
      finish(op);
      op.no(err); op.rej(err);
    }
    function take() {
      let n = 0;
      if (!outbox[0].cond) {
        let bytes = 0;
        while (n < outbox.length && !outbox[n].cond && n < MAX_OPS && (n === 0 || bytes + outbox[n].size <= MAX_BYTES)) bytes += outbox[n++].size;
      } else {
        const keys = new Set();
        while (n < outbox.length && n < PAR && outbox[n].cond && !keys.has(outbox[n].k)) keys.add(outbox[n++].k);
      }
      return outbox.splice(0, n);
    }
    function flush() {
      flushTimer = null;
      if (!pumping) pump();
    }
    // Un gruppo alla volta. Se la rete o il server non rispondono, il gruppo resta in testa e si ritenta dopo 2, 5, 10, 20 secondi,
    // poi ogni 30: le scritture successive aspettano, così l'ordine resta quello in cui sono state chieste.
    async function pump() {
      pumping = true;
      try {
        while (outbox.length) {
          flight = take();
          let again;
          try {
            if (flight[0].cond) { const ok = await Promise.all(flight.map(sendOne)); again = flight.filter((_, i) => !ok[i]); }
            else again = await sendGroup(flight);
          } catch (e) {
            console.error(e);
            flight.forEach((op) => { if (!op.finished) fail(op, { code: "unavailable", message: String(e?.message || e) }); });
            again = [];
          }
          flight = [];
          if (!again.length) { fails = 0; if (retrying) report(); continue; }
          outbox.unshift(...again);
          const now = Date.now(), old = again.filter((op) => now - (op.firstFail ??= now) >= GIVE_UP);
          old.forEach((op) => fail(op, { code: "unavailable", message: "Il server dei dati non risponde da 10 minuti." }));
          if (old.length) { outbox.splice(0, outbox.length, ...outbox.filter((op) => !op.dead)); if (old.length === again.length) continue; }
          if (!retrying) { retrying = true; outbox.forEach((op) => op.ok()); }
          report();
          await new Promise((r) => setTimeout(r, WAITS[Math.min(fails++, WAITS.length - 1)]));
        }
      } finally {
        flight = [];
        pumping = false;
        if (retrying) { retrying = false; report(); }
      }
    }
    async function sendGroup(group) {
      try {
        if (group.length === 1) {
          const g = group[0];
          const r = await api(url(g.c, g.id), g.data === null ? { method: "DELETE" } : { method: "PUT", body: g.data });
          g.stale = !raise(g.k, r.at, g.data !== null);
        } else {
          const r = await api(`/api/projects/${encodeURIComponent(pid)}/batch`, { method: "POST", body: { ops: group.map((g) => ({ col: g.c, id: g.id, data: g.data })) } });
          const at = new Map((r.items || []).map((x) => [`${x.col}/${x.id}`, x.at]));
          for (const g of group) g.stale = !raise(g.k, at.get(g.k), g.data !== null);
        }
        group.forEach(done);
        return [];
      } catch (e) {
        if (retryable(e)) return group;
        for (const g of group) fail(g, e);
        return [];
      }
    }
    // Scrittura condizionale: parte con la versione conosciuta. Se un collega ha salvato prima (409) si rilegge l'elemento e
    // la funzione di modifica si riapplica sui suoi dati, al massimo 3 volte; un contenuto fisso non si riapplica.
    async function sendOne(op) {
      for (;;) {
        const base = known.get(op.k);
        if (op.fn && op.from !== base) recompute(op, base);
        if (op.gone) { fail(op, { code: "gone" }); return true; }
        if (op.same) { done(op); return true; }
        try {
          // chi scrive può dare la base (il lock: la versione scritta da questa scheda) al posto di quella conosciuta
          const headers = { "x-base": op.base ?? baseOf(op.k) };
          const r = await api(url(op.c, op.id), op.data === null ? { method: "DELETE", headers } : { method: "PUT", body: op.data, headers });
          op.stale = !raise(op.k, r.at, op.data !== null);
          op.at = r.at;
          done(op);
          return true;
        } catch (e) {
          if (e.code !== "conflict") { if (retryable(e)) return false; fail(op, e); return true; }
          let fresh = null;
          try { if (e.at !== null) fresh = await fetchItem(op.c, op.id); } catch (e2) { if (retryable(e2)) return false; fail(op, e2); return true; }
          known.set(op.k, fresh ? fresh.data : undefined);
          mark(op.k, fresh?.at, !!fresh);
          if (!op.fn || ++op.tries > 3) { fail(op, e); return true; }
          refold(op.c, op.id);
        }
      }
    }
    async function fetchItem(c, id) {
      try { const r = await api(url(c, id)); return { data: r.item.data, at: r.item.at, now: r.now }; }
      catch (e) { if (e.code === "not_found") return null; throw e; }
    }
    // Lettura di un elemento dal server (dati freschi, versione e ora del server); senza scritture in attesa aggiorna anche la pagina.
    async function fetchOne(c, id) {
      const r = await fetchItem(c, id), k = `${c}/${id}`;
      if (r?.now) BS.onClock?.(Number(r.now));
      if (!pending.has(k)) {
        mark(k, r?.at, !!r);
        const before = get(c, id);
        apply(c, id, r?.data);
        if (JSON.stringify(before) !== JSON.stringify(r?.data)) notify(c);
      }
      return r;
    }
    // chi chiude o ricarica la scheda mentre un salvataggio è in corso (o in attesa di ritentativo) riceve l'avviso del browser invece di perderlo
    window.addEventListener("beforeunload", (e) => { if (pending.size || outbox.length || retrying) { e.preventDefault(); e.returnValue = ""; } });
    // per i test e le misure: finisce quando non resta nulla da inviare né in viaggio (ritentativi compresi)
    BS.writesDone = async () => { while (outbox.length || flushTimer || pumping) await new Promise((r) => setTimeout(r, 10)); };
    const ref = (c, id) => ({ set: (d) => write(c, id, d).done, delete: () => write(c, id, null).done });
    async function poll() {
      try {
        const r = await api(`/api/projects/${encodeURIComponent(pid)}?since=${encodeURIComponent(since)}`);
        since = r.now;
        BS.onClock?.(Date.parse(r.now) * 1000);
        const changed = new Set();
        for (const it of r.items) {
          const k = `${it.col}/${it.id}`;
          // con scritture in attesa la pagina non cambia, ma si ricorda la versione nuova: se la scrittura fallisce si torna a questa
          if (pending.has(k)) { const v = ver.get(k); if (it.at != null && !(v && Number(it.at) <= v.at)) { mark(k, it.at, !it.deleted); known.set(k, it.deleted ? undefined : it.data); } continue; }
          // l'eco delle proprie scritture (o una versione già vista) non cambia nulla
          if (it.at != null) { const v = ver.get(k); if (v && Number(it.at) <= v.at) continue; mark(k, it.at, !it.deleted); }
          const cur = store[it.col]?.[it.id];
          if (it.deleted) {
            if (cur !== undefined) { apply(it.col, it.id, null); changed.add(it.col); }
          } else if (JSON.stringify(cur) !== JSON.stringify(it.data)) {
            // segnaposto della stessa versione che abbiamo già intera (per esempio l'eco di un nostro salvataggio): si tiene l'intera
            if (BS.isLazy(it.data) && cur !== undefined && !BS.isLazy(cur) && BS.fingerprint(cur) === it.data._lazy.v) continue;
            apply(it.col, it.id, it.data);
            changed.add(it.col);
            BS.onRemote?.(it.col, it.id, it.by || "");
          }
        }
        changed.forEach(notify);
        if ([...changed].some((c) => c !== "presence")) lastActive = Date.now(); // qualcuno sta lavorando: si resta rapidi (i battiti di presenza non contano)
        BS.onSync?.(true);
      } catch (e) {
        BS.onSync?.(false, e);
      }
    }
    // Contenuto completo di un segnaposto; richieste uguali in contemporanea diventano una sola.
    // Se nel frattempo è arrivata una versione nuova, si richiede quella.
    const loading = new Map();
    function load(c, id) {
      const k = `${c}/${id}`;
      if (!BS.isLazy(store[c]?.[id])) return Promise.resolve(store[c]?.[id]);
      if (!loading.has(k)) {
        loading.set(k, (async () => {
          for (let i = 0; i < 3; i++) {
            const before = store[c]?.[id];
            const r = await api(url(c, id));
            const now = store[c]?.[id];
            if (!BS.isLazy(now)) return now; // eliminato o già intero (salvato da qui)
            // il server dà la versione più recente; si scarta solo se durante la richiesta è arrivato un segnaposto diverso
            if (now === before || r.item.v === now._lazy.v) { apply(c, id, r.item.data); if (!pending.has(k)) mark(k, r.item.at, true); notify(c); return r.item.data; }
          }
          throw { code: "unavailable", message: "Il contenuto cambia di continuo: riprova tra poco." };
        })().finally(() => loading.delete(k)));
      }
      return loading.get(k);
    }
    // Sincronizzazione: ogni 6 secondi mentre si lavora; dopo 2 minuti senza modifiche né interazioni, ogni 30 secondi.
    // Al primo clic o tasto dopo una pausa si sincronizza subito e si torna rapidi. Con la scheda nascosta non si chiede nulla.
    const FAST = 6000, SLOW = 30000, QUIET = 120000;
    let lastActive = Date.now(), timer = null, busy = false;
    const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(tick, ms); };
    async function tick() {
      if (busy) return;
      busy = true;
      try { if (!document.hidden) await poll(); } finally { busy = false; schedule(Date.now() - lastActive < QUIET ? FAST : SLOW); }
    }
    function touch() {
      const wasQuiet = Date.now() - lastActive >= QUIET;
      lastActive = Date.now();
      if (wasQuiet) schedule(0);
    }
    for (const ev of ["pointerdown", "keydown"]) document.addEventListener(ev, touch, { capture: true, passive: true });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { lastActive = Date.now(); schedule(0); } });
    schedule(FAST);
    return {
      doc: (path) => { const [c, id] = path.split("/"); return ref(c, id); },
      collection: (c) => ({
        doc: (id) => ref(c, id),
        onSnapshot(cb) {
          (subs[c] ||= []).push(cb);
          setTimeout(() => cb(snap(c)), 0);
          return () => { subs[c] = subs[c].filter((f) => f !== cb); };
        },
      }),
      write,
      fetch: fetchOne,
      poll,
      load,
    };
  };

  /* ---------- Jira: stesse operazioni e risposte del connettore Atlassian ---------- */
  BS.mcp = {
    async callTool(_server, tool, input, opts = {}) {
      const r = await api(`/api/jira/${encodeURIComponent(tool)}`, { method: "POST", body: input || {}, signal: opts.signal });
      return { payload: r.payload };
    },
  };

  /* ---------- Claude: ponte locale Claude Code (npm run claude) ---------- */
  const lsGet = (k) => { try { return localStorage.getItem("bs:" + k) || ""; } catch { return ""; } };
  const lsSet = (k, v) => { try { v ? localStorage.setItem("bs:" + k, v) : localStorage.removeItem("bs:" + k); } catch {} };
  BS.DEFAULT_BRIDGE = "http://127.0.0.1:8790";
  BS.bridgeUrl = () => (lsGet("bridge") || BS.DEFAULT_BRIDGE).replace(/\/+$/, "");
  BS.bridgeToken = () => lsGet("bridgeToken");
  BS.setBridge = (url, token) => { lsSet("bridge", String(url || "").trim()); lsSet("bridgeToken", String(token || "").trim()); };
  const bridgeHeaders = (extra = {}) => ({ ...extra, ...(BS.bridgeToken() ? { "x-bridge-token": BS.bridgeToken() } : {}) });
  BS.checkBridge = async () => {
    try {
      const r = await fetch(`${BS.bridgeUrl()}/health`, { headers: bridgeHeaders(), signal: AbortSignal.timeout(3500) });
      const d = await r.json();
      return d.ok ? d : null;
    } catch {
      return null;
    }
  };
  const EFFORT = { quick: "low", default: "medium", complex: "high" };

  async function imageBlock(file) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1568 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const data = c.toDataURL("image/jpeg", 0.85).split(",")[1];
    return { type: "image", source: { type: "base64", media_type: "image/jpeg", data } };
  }

  // Una richiesta all'API Messages in streaming: ricostruisce i blocchi della risposta dagli eventi SSE.
  async function streamOnce(body, signal, onDelta) {
    let r;
    try {
      r = await fetch(`${BS.bridgeUrl()}/ai`, { method: "POST", headers: bridgeHeaders({ "content-type": "application/json" }), body: JSON.stringify(body), signal });
    } catch {
      throw { code: signal?.aborted ? "cancelled" : "bridge_offline" };
    }
    if (!r.ok) {
      let d = {};
      try { d = await r.json(); } catch {}
      throw { code: d.code === "forbidden" ? "bridge_forbidden" : d.code || "upstream_error", message: d.message };
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    const blocks = [];
    let buf = "";
    let stop = null;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
          if (!data) continue;
          let ev;
          try { ev = JSON.parse(data); } catch { continue; }
          if (ev.type === "content_block_start") {
            const b = (blocks[ev.index] = { ...ev.content_block });
            if (b.type === "tool_use") b._json = "";
            if (b.type === "text" && b.text) onDelta(b.text);
          } else if (ev.type === "content_block_delta") {
            const b = blocks[ev.index];
            const d = ev.delta || {};
            if (!b) continue;
            if (d.type === "text_delta") { b.text = (b.text || "") + d.text; onDelta(d.text); }
            else if (d.type === "thinking_delta") b.thinking = (b.thinking || "") + d.thinking;
            else if (d.type === "signature_delta") b.signature = d.signature;
            else if (d.type === "input_json_delta") b._json += d.partial_json;
            else if (d.type === "citations_delta") (b.citations ||= []).push(d.citation);
          } else if (ev.type === "content_block_stop") {
            const b = blocks[ev.index];
            if (b?.type === "tool_use") {
              try { b.input = b._json ? JSON.parse(b._json) : {}; } catch { b.input = {}; b._bad = true; }
              delete b._json;
            }
          } else if (ev.type === "message_delta") {
            if (ev.delta?.stop_reason) stop = ev.delta.stop_reason;
          } else if (ev.type === "error") {
            throw {
              code: ev.error?.type === "rate_limit_error" ? "rate_limited" : ev.error?.type === "authentication_error" ? "bridge_login" : "upstream_error",
              message: ev.error?.message,
            };
          }
        }
      }
    } catch (e) {
      if (signal?.aborted) throw { code: "cancelled" };
      throw e?.code ? e : { code: "upstream_error", message: String(e) };
    }
    const list = blocks.filter(Boolean);
    return {
      content: list.map(({ _bad, ...b }) => b),
      bad: new Set(list.filter((b) => b._bad).map((b) => b.id)),
      stop_reason: stop,
    };
  }

  async function sample(input, opts = {}) {
    let messages = typeof input === "string" ? [{ role: "user", content: input }] : input.map((t) => ({ role: t.role, content: t.content }));
    if (!messages.length || messages.at(-1).role !== "user") throw { code: "invalid_request" };
    if (opts.images) {
      const files = opts.images instanceof Blob ? [opts.images] : [...opts.images];
      const imgs = await Promise.all(files.map(imageBlock)).catch(() => { throw { code: "image_rejected" }; });
      const last = messages.at(-1);
      messages = [...messages.slice(0, -1), { role: "user", content: [...imgs, { type: "text", text: String(last.content) }] }];
    }
    const tools = []; // il ponte Claude Code non espone strumenti della pagina
    const defs = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema || { type: "object", properties: {} } }));
    const effort = EFFORT[opts.modelTier || "default"] || "medium";
    let text = "";
    let sep = false;
    let truncated = false;
    const onDelta = (d) => {
      if (sep && text) text += "\n\n";
      sep = false;
      text += d;
      try { opts.onText?.({ text, delta: d }); } catch (e) { console.error(e); }
    };
    try {
      for (let round = 0; round < 8; round++) {
        sep = round > 0;
        const msg = await streamOnce({ messages, effort, tools: defs }, opts.signal, onDelta);
        if (msg.stop_reason === "refusal") throw { code: "refused" };
        if (msg.stop_reason === "max_tokens") truncated = true;
        const uses = msg.content.filter((b) => b.type === "tool_use");
        if (msg.stop_reason !== "tool_use" || !uses.length || truncated) break;
        const results = await Promise.all(
          uses.map(async (u) => {
            try {
              const t = tools.find((x) => x.name === u.name);
              if (!t) throw new Error("strumento sconosciuto");
              if (msg.bad.has(u.id)) throw new Error("input non valido: riprova con un JSON completo");
              const out = await t.execute(u.input || {}, { signal: opts.signal || new AbortController().signal });
              return { type: "tool_result", tool_use_id: u.id, content: typeof out === "string" ? out : JSON.stringify(out ?? null) };
            } catch (e) {
              return { type: "tool_result", tool_use_id: u.id, content: `Error: ${e?.message || e}`, is_error: true };
            }
          }),
        );
        messages = [...messages, { role: "assistant", content: msg.content }, { role: "user", content: results }];
      }
    } catch (e) {
      throw { ...(e?.code ? e : { code: "upstream_error" }), ...(text && e?.code !== "refused" ? { text } : {}) };
    }
    if (!text.trim()) throw { code: "empty_completion" };
    return { text, truncated, modelTierApplied: opts.modelTier || "default" };
  }

  function parseLoose(t) {
    const s = String(t || "").trim();
    try { return JSON.parse(s); } catch {}
    const f = s.match(/```(?:json)?\s*\n([\s\S]*?)```/);
    if (f) { try { return JSON.parse(f[1]); } catch {} }
    const a = s.search(/[[{]/);
    const b = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }
    return undefined;
  }

  sample.json = async (input, opts = {}) => {
    const suffix = "\n\nRispondi con un solo valore JSON valido, senza testo prima o dopo e senza blocchi di codice.";
    const inp = typeof input === "string" ? input + suffix : [...input.slice(0, -1), { ...input.at(-1), content: input.at(-1).content + suffix }];
    const r = await sample(inp, opts);
    const v = parseLoose(r.text);
    if (v === undefined || r.truncated) throw { code: "invalid_json", text: r.text };
    return v;
  };
  sample.limits = async () => ({
    maxPromptBytes: 4_000_000,
    images: { maxCount: 5, maxInputBytes: 20_000_000, mediaTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"] },
  });
  BS.sample = sample;

  /* ---------- download ---------- */
  BS.downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    },
  };
})();
