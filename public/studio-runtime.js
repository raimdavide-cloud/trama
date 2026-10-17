// Runtime di Trama sul sito: dati condivisi (Postgres), Jira (OAuth Atlassian) e Claude (API Anthropic).
// Espone le stesse interfacce usate dallo strumento: DB (doc/collection/onSnapshot), MCP.callTool, sample().
(() => {
  const BS = (window.BS = {});

  async function api(path, { method = "GET", body, signal } = {}) {
    let r;
    try {
      r = await fetch(path, {
        method,
        credentials: "same-origin",
        headers: body !== undefined ? { "content-type": "application/json" } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (e) {
      throw { code: signal?.aborted ? "cancelled" : "server_unavailable", message: "Connessione non riuscita.", retryable: true };
    }
    let data = {};
    try { data = await r.json(); } catch {}
    if (r.status === 401) {
      BS.onUnauthenticated?.(data.code);
      throw { code: data.code === "needs_reauth" ? "needs_reauth" : "unauthenticated", message: data.message || "Sessione scaduta." };
    }
    if (!r.ok || data.ok === false) {
      throw { code: data.code || "upstream_error", message: data.message || `HTTP ${r.status}`, retryable: !!data.retryable, status: r.status };
    }
    return data;
  }
  BS.api = api;

  /* ---------- dati condivisi: stessa forma del db degli artifact ---------- */
  BS.createDB = (pid, initial) => {
    const store = {};
    const subs = {};
    const pending = new Map();
    let since = initial.now;
    for (const it of initial.items) (store[it.col] ||= {})[it.id] = it.data;
    const snap = (c) => ({ docs: Object.entries(store[c] || {}).map(([id, d]) => ({ id, exists: true, data: () => d })) });
    const notify = (c) => (subs[c] || []).forEach((f) => f(snap(c)));
    const apply = (c, id, data) => {
      if (data === null) delete (store[c] || {})[id];
      else (store[c] ||= {})[id] = data;
    };
    const url = (c, id) => `/api/projects/${encodeURIComponent(pid)}/items/${c}/${encodeURIComponent(id)}`;
    // Salvataggi: quelli chiesti nello stesso momento (per esempio la rinomina di una release che tocca cento elementi)
    // partono insieme in una sola richiesta. Un gruppo alla volta, nell'ordine in cui sono stati chiesti.
    const MAX_OPS = 500, MAX_BYTES = 3_500_000;
    const outbox = [];
    let flushTimer = null, chain = Promise.resolve();
    const writeErr = (e) => ({
      code: e.code === "too_large" ? "quota_exceeded" : e.code === "unauthenticated" || e.code === "not_found" ? "revoked" : "unavailable",
      message: e.message,
    });
    function write(c, id, data) {
      const k = `${c}/${id}`;
      pending.set(k, (pending.get(k) || 0) + 1);
      touch();
      return new Promise((resolve, reject) => {
        outbox.push({ c, id, data, k, size: data === null ? 0 : JSON.stringify(data).length, resolve, reject });
        flushTimer ??= setTimeout(flush, 0);
      });
    }
    function flush() {
      flushTimer = null;
      let bytes = 0, n = 0;
      while (n < outbox.length && n < MAX_OPS && (n === 0 || bytes + outbox[n].size <= MAX_BYTES)) bytes += outbox[n++].size;
      const group = outbox.splice(0, n);
      if (outbox.length) flushTimer = setTimeout(flush, 0);
      chain = chain.then(() => send(group));
    }
    async function send(group) {
      try {
        if (group.length === 1) {
          const g = group[0];
          await api(url(g.c, g.id), g.data === null ? { method: "DELETE" } : { method: "PUT", body: g.data });
        } else {
          await api(`/api/projects/${encodeURIComponent(pid)}/batch`, { method: "POST", body: { ops: group.map((g) => ({ col: g.c, id: g.id, data: g.data })) } });
        }
        for (const g of group) { apply(g.c, g.id, g.data); g.resolve(); }
      } catch (e) {
        const err = writeErr(e);
        for (const g of group) g.reject(err);
      } finally {
        for (const g of group) { const n = pending.get(g.k) - 1; n ? pending.set(g.k, n) : pending.delete(g.k); }
      }
    }
    // chi chiude o ricarica la scheda mentre un salvataggio è in corso riceve l'avviso del browser invece di perderlo
    window.addEventListener("beforeunload", (e) => { if (pending.size) { e.preventDefault(); e.returnValue = ""; } });
    // per i test e le misure: finisce quando non resta nulla da inviare né in viaggio
    BS.writesDone = async () => { while (outbox.length || flushTimer) await new Promise((r) => setTimeout(r, 0)); await chain; };
    const ref = (c, id) => ({ set: (d) => write(c, id, d), delete: () => write(c, id, null) });
    async function poll() {
      try {
        const r = await api(`/api/projects/${encodeURIComponent(pid)}?since=${encodeURIComponent(since)}`);
        since = r.now;
        const changed = new Set();
        for (const it of r.items) {
          if (pending.has(`${it.col}/${it.id}`)) continue;
          const cur = store[it.col]?.[it.id];
          if (it.deleted) {
            if (cur !== undefined) { apply(it.col, it.id, null); changed.add(it.col); }
          } else if (JSON.stringify(cur) !== JSON.stringify(it.data)) {
            apply(it.col, it.id, it.data);
            changed.add(it.col);
          }
        }
        changed.forEach(notify);
        if (changed.size) lastActive = Date.now(); // qualcuno sta lavorando: si resta rapidi
        BS.onSync?.(true);
      } catch (e) {
        BS.onSync?.(false, e);
      }
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
      poll,
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
