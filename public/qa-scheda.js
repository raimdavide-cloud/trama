/* Scheda QA: dal ticket e da ciò che lo circonda (requisito, dipendenze, registro decisioni) un Markdown pronto per chi collauda.
   Per ogni release anche il piano di test e uno zip con tutte le schede. Funzioni pure sui dati: le usano Trama e i test unitari.
   I titoli delle sezioni passano da ctx.tr (la lingua dell'interfaccia); i contenuti restano nella lingua in cui sono scritti. */
(function (W) {
  const OUT_OF_SCOPE = ["Spike", "UX Story"]; // non si collaudano: nel piano finiscono «fuori perimetro»
  // righe segnaposto dei modelli vuoti: non sono contenuto
  const PLACEHOLDER = /^(Verifiable outcomes, one per bullet|Decisions not yet taken, with the options|Tickets that must be done first|Related tickets, documents, design frames|What to build or change, one bullet per piece of work|API, data and compatibility constraints \(what must not break\)|Why this is needed: the requirement, the decision or the gap that triggers it|As a <role>, I want <capability>, so that <benefit>)\.?$/i;

  // «## Titolo» della descrizione → { "titolo": "testo" }
  function sections(desc) {
    const out = {};
    let cur = null;
    for (const l of String(desc || "").split(/\r?\n/)) {
      const m = l.match(/^#{2,3}\s+(.+?)\s*$/);
      if (m) { cur = m[1].trim(); out[cur] = []; } else if (cur) out[cur].push(l);
    }
    for (const k in out) out[k] = out[k].join("\n").trim();
    return out;
  }
  const lines = (s) => String(s || "").split(/\r?\n/).map((l) => l.replace(/^\s*(?:[*\-•]|\d+[.)])\s+/, "").trim()).filter((l) => l && !PLACEHOLDER.test(l));
  const text = (s) => lines(s).join("\n");
  const pick = (sec, name) => { const k = Object.keys(sec).find((x) => x.toLowerCase() === name); if (k === undefined) return ""; const v = sec[k]; delete sec[k]; return v; };
  const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
  const yamlStr = (s) => (/^[\w .\-/()àèéìòù]*$/i.test(String(s ?? "")) ? String(s ?? "") : JSON.stringify(String(s ?? "")));
  const yamlList = (a) => "[" + (a || []).map(yamlStr).join(", ") + "]";
  const slug = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "senza-nome";
  const mentions = (hay, codes) => codes.filter(Boolean).some((c) => new RegExp("(^|[^A-Za-z0-9-])" + c.replace(/[-]/g, "\\-") + "(?![A-Za-z0-9-]|-\\d)").test(hay));
  const plural = (n, one, many) => (n === 1 ? "1 " + one : n + " " + many);

  // decisioni ancora valide (non sostituite da una successiva)
  function activeDecisions(decisions) {
    const replaced = new Set((decisions || []).map((d) => d.replaces).filter(Boolean));
    return (decisions || []).filter((d) => !replaced.has(d.id)).sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  }
  const decLine = (d, tr) => `- ${d.date ? d.date + " · " : ""}${cell(d.text)}${d.who ? ` · ${tr("Chi")}: ${cell(d.who)}` : ""}${d.source ? ` · ${tr("Fonte")}: ${cell(d.source)}` : ""}${d.impact ? ` · ${tr("Impatto")}: ${cell(d.impact)}` : ""}`;

  // cosa manca perché il ticket sia pronto per il collaudo
  function gapsOf(t, info) {
    const g = [];
    if (!info.ac.length) g.push("Mancano i criteri di accettazione");
    if (info.assumptions.length) g.push(plural(info.assumptions.length, "ipotesi da confermare", "ipotesi da confermare"));
    if (info.clarify.length) g.push(plural(info.clarify.length, "punto da chiarire", "punti da chiarire"));
    if (!t.key) g.push("Non ancora creato in Jira");
    return g;
  }

  function analyze(t, ctx) {
    const sec = sections(t.desc);
    const ac = lines(pick(sec, "acceptance criteria"));
    const clarify = lines(pick(sec, "points to clarify"));
    const assumptions = (t.assumptions || []).map((a) => String(a).trim()).filter(Boolean);
    const all = ctx.tickets || [];
    const byRef = new Map(all.map((x) => [x.ref, x]));
    const own = t.links || [];
    const after = [
      ...all.filter((o) => o !== t && (o.links || []).some((l) => l.type === "blocks" && l.to === t.ref)),
      ...own.filter((l) => /blocked/i.test(l.type)).map((l) => byRef.get(l.to) || { ref: l.to }),
    ];
    const unblocks = own.filter((l) => l.type === "blocks").map((l) => byRef.get(l.to) || { ref: l.to });
    const related = own.filter((l) => l.type !== "blocks" && !/blocked/i.test(l.type)).map((l) => byRef.get(l.to) || { ref: l.to });
    const req = (ctx.reqs || []).find((r) => r.code === t.req) || null;
    const codes = [t.req, t.ref, t.key];
    const decisions = activeDecisions(ctx.decisions).filter((d) => mentions(`${d.text || ""} ${d.impact || ""} ${d.kit || ""}`, codes));
    const info = { sec, ac, clarify, assumptions, after, unblocks, related, req, decisions };
    info.gaps = gapsOf(t, info);
    info.ready = !info.gaps.length;
    return info;
  }

  function sheet(t, ctx) {
    const tr = ctx.tr || ((s) => s);
    const i = analyze(t, ctx);
    const title = ctx.fullTitle ? ctx.fullTitle(t) : t.title;
    const url = t.key && ctx.siteUrl ? `${ctx.siteUrl}/browse/${t.key}` : "";
    const tk = (x) => `${x.ref}${x.key ? ` (${x.key})` : ""}${x.title ? " · " + cell(ctx.fullTitle ? ctx.fullTitle(x) : x.title) : ""}`;
    const H = (s) => "\n## " + tr(s) + "\n";
    const sec = { ...i.sec };
    const ctxText = text(pick(sec, "context")), story = text(pick(sec, "user story")), scope = lines(pick(sec, "scope / action") || pick(sec, "action"));
    const deps = lines(pick(sec, "dependencies")), refs = lines(pick(sec, "references") || pick(sec, "reference"));
    let md = "---\n" + [
      `ticket: ${yamlStr(t.key || "")}`, `ref: ${yamlStr(t.ref)}`, `tipo: ${yamlStr(ctx.typeName ? ctx.typeName(t) : t.type)}`,
      `requisito: ${yamlStr(t.req || "")}`, `release: ${yamlStr(t.release || "")}`, `epica: ${yamlStr(t.epic || "")}`,
      `componenti: ${yamlList(i.req?.components)}`, `label: ${yamlList(ctx.labels ? ctx.labels(t) : t.labels)}`,
      `jira: ${yamlStr(url)}`, `pronta_per_qa: ${i.ready}`, `generata: ${yamlStr(ctx.today || "")}`,
    ].join("\n") + "\n---\n";
    md += `# ${title}\n\n> ${tr("Scheda QA generata da Trama")}${ctx.project ? " · " + ctx.project : ""}. ${tr("Fonti: ticket, requisito, collegamenti e registro decisioni.")}\n`;
    md += H("Prima di iniziare") + (i.ready ? `- ✅ ${tr("Nessun punto aperto: la scheda è completa.")}\n` : i.gaps.map((g) => `- ⚠️ ${tr(g)}`).join("\n") + "\n");
    md += H("Cosa verificare") + (i.ac.length ? i.ac.map((a, n) => `- [ ] AC${n + 1} · ${a}`).join("\n") + "\n" : `- ${tr("Nessun criterio di accettazione nel ticket: chiedili al PO prima del collaudo.")}\n`);
    if (i.req) {
      const r = i.req;
      md += H("Da dove nasce") + `**${r.code} · ${cell(r.title)}**${r.source ? ` (${tr("fonte")}: ${cell(r.source)})` : ""}\n\n${String(r.desc || "").trim()}\n`;
      const rows = [["Componenti", (r.components || []).join(", ")], ["Note UI/UX", r.ui], ["Dipendenze esterne", r.extDeps], ["Dipendenze interne", r.intDeps], ["Design pronto", r.designReady === undefined ? "" : tr(r.designReady ? "sì" : "no")]].filter(([, v]) => String(v || "").trim());
      if (rows.length) md += "\n" + rows.map(([k, v]) => `- ${tr(k)}: ${cell(v)}`).join("\n") + "\n";
    }
    if (ctxText || story) md += H("Contesto e storia") + [ctxText, story].filter(Boolean).join("\n\n") + "\n";
    if (scope.length) md += H("Cosa è stato realizzato") + scope.map((s) => `- ${s}`).join("\n") + "\n";
    // le altre sezioni del modello (per i Bug: passi, atteso, ottenuto) restano con il loro titolo
    for (const [k, v] of Object.entries(sec)) { const b = lines(v); if (b.length) md += `\n## ${k}\n` + b.map((s) => `- ${s}`).join("\n") + "\n"; }
    if (i.after.length || i.unblocks.length || i.related.length || deps.length) {
      md += H("Dipendenze");
      if (i.after.length) md += i.after.map((x) => `- ${tr("Da collaudare dopo")}: ${tk(x)}`).join("\n") + "\n";
      if (i.unblocks.length) md += i.unblocks.map((x) => `- ${tr("Sblocca")}: ${tk(x)}`).join("\n") + "\n";
      if (i.related.length) md += i.related.map((x) => `- ${tr("Collegato a")}: ${tk(x)}`).join("\n") + "\n";
      if (deps.length) md += deps.map((d) => `- ${d}`).join("\n") + "\n";
    }
    if (i.assumptions.length) md += H("Ipotesi da confermare") + i.assumptions.map((a) => `- ⚠️ ${a}`).join("\n") + "\n";
    if (i.clarify.length) md += H("Punti da chiarire") + i.clarify.map((a) => `- ${a}`).join("\n") + "\n";
    if (i.req && String(i.req.questions || "").trim()) md += H("Domande aperte del requisito") + `- ${cell(i.req.questions)}\n`;
    md += H("Decisioni che toccano questo ticket") + (i.decisions.length ? i.decisions.map((d) => decLine(d, tr)).join("\n") + "\n" : `- ${tr("Nessuna decisione del registro cita questo ticket o il suo requisito. Le decisioni di progetto sono nel piano di test della release.")}\n`);
    if (refs.length) md += H("Riferimenti") + refs.map((r) => `- ${r}`).join("\n") + "\n";
    md += H("Appunti del QA") + "- \n";
    return { md, ready: i.ready, gaps: i.gaps, ac: i.ac.length, name: fileName(t, title) };
  }
  const fileName = (t, title) => `${t.key || t.ref}-${slug(String(title || "").replace(/^\s*\[[^\]]+\]\s*/, ""))}.md`;

  const inScope = (t) => !OUT_OF_SCOPE.includes(t.type);

  // ordine di collaudo: prima chi non aspetta nessuno, poi chi è sbloccato
  function testOrder(ts) {
    const refs = new Set(ts.map((t) => t.ref));
    const waits = new Map(ts.map((t) => [t.ref, new Set()]));
    for (const t of ts) for (const l of t.links || []) {
      if (l.type === "blocks" && refs.has(l.to)) waits.get(l.to).add(t.ref);
      if (/blocked/i.test(l.type) && refs.has(l.to)) waits.get(t.ref).add(l.to);
    }
    const out = [], done = new Set();
    while (out.length < ts.length) {
      const next = ts.filter((t) => !done.has(t.ref) && [...waits.get(t.ref)].every((r) => done.has(r)));
      const step = next.length ? next : ts.filter((t) => !done.has(t.ref)).slice(0, 1); // ciclo: si va avanti comunque
      for (const t of step) { done.add(t.ref); out.push({ t, after: [...waits.get(t.ref)] }); }
    }
    return out;
  }

  function plan(release, ctx) {
    const tr = ctx.tr || ((s) => s);
    const H = (s) => "\n## " + tr(s) + "\n";
    const ts = (ctx.tickets || []).filter((t) => (release === null ? !t.release : t.release === release));
    const test = ts.filter(inScope), out = ts.filter((t) => !inScope(t));
    const info = new Map(test.map((t) => [t, analyze(t, ctx)]));
    const ready = test.filter((t) => info.get(t).ready).length;
    const reqs = (ctx.reqs || []).filter((r) => (release === null ? !r.release : r.release === release));
    const noTickets = reqs.filter((r) => !(ctx.tickets || []).some((t) => t.req === r.code));
    const nfr = reqs.filter((r) => /^RNF/i.test(r.code));
    const title = (t) => (ctx.fullTitle ? ctx.fullTitle(t) : t.title);
    const relName = release === null ? tr("Senza release") : release;
    let md = "---\n" + [`release: ${yamlStr(relName)}`, `progetto: ${yamlStr(ctx.project || "")}`, `schede: ${test.length}`, `pronte: ${ready}`, `generato: ${yamlStr(ctx.today || "")}`].join("\n") + "\n---\n";
    md += `# ${tr("Piano di test")} · ${relName}\n\n> ${tr("Generato da Trama: una scheda per ogni ticket nella cartella «schede».")}\n`;
    md += H("In sintesi") + [
      `- ${tr("Ticket da collaudare")}: ${test.length} (${tr("pronti")}: ${ready}, ${tr("con punti aperti")}: ${test.length - ready})`,
      `- ${tr("Fuori perimetro (Spike e UX Story)")}: ${out.length}`,
      `- ${tr("Requisiti della release")}: ${reqs.length} (${tr("senza ticket")}: ${noTickets.length})`,
    ].join("\n") + "\n";
    if (test.length) {
      md += H("Ordine consigliato") + testOrder(test).map(({ t, after }, n) => `${n + 1}. ${t.ref}${t.key ? ` (${t.key})` : ""} · ${cell(title(t))}${after.length ? ` · ${tr("dopo")} ${after.join(", ")}` : ""}`).join("\n") + "\n";
      md += H("Perimetro") + `| ${["Ticket", "Jira", "Tipo", "Titolo", "Epica", "Requisito", "AC", "Scheda"].map(tr).join(" | ")} |\n|---|---|---|---|---|---|---|---|\n`;
      md += test.map((t) => { const i = info.get(t); return `| ${t.ref} | ${t.key || "—"} | ${cell(ctx.typeName ? ctx.typeName(t) : t.type)} | ${cell(title(t))} | ${cell(t.epic || "—")} | ${t.req || "—"} | ${i.ac.length} | ${i.ready ? tr("pronta") : tr("da completare")} |`; }).join("\n") + "\n";
      const risky = test.filter((t) => !info.get(t).ready);
      if (risky.length) md += H("Rischi e punti aperti") + risky.map((t) => `- ${t.ref} · ${cell(title(t))}: ${info.get(t).gaps.map(tr).join("; ")}`).join("\n") + "\n";
    }
    if (noTickets.length) md += H("Requisiti senza ticket") + noTickets.map((r) => `- ${r.code} · ${cell(r.title)}`).join("\n") + "\n";
    if (nfr.length) md += H("Requisiti non funzionali da verificare") + nfr.map((r) => `- ${r.code} · ${cell(r.title)}${r.desc ? ": " + cell(r.desc) : ""}`).join("\n") + "\n";
    const decs = activeDecisions(ctx.decisions);
    if (decs.length) md += H("Decisioni di progetto") + decs.map((d) => decLine(d, tr)).join("\n") + "\n";
    if (out.length) md += H("Fuori perimetro") + out.map((t) => `- ${t.ref} · ${cell(ctx.typeName ? ctx.typeName(t) : t.type)} · ${cell(title(t))}`).join("\n") + "\n";
    md += H("Da compilare a cura del QA") + ["Ambienti", "Dati di test", "Dispositivi e browser", "Criteri di uscita"].map((s) => `- ${tr(s)}: `).join("\n") + "\n";
    return { md, tickets: test, ready, out: out.length };
  }

  // tutte le schede e il piano di una o più release: [{ name, text }]
  function bundle(releases, ctx) {
    const files = [];
    let sheets = 0;
    for (const rel of releases) {
      const p = plan(rel, ctx);
      if (!p.tickets.length && !p.out) continue;
      const dir = releases.length > 1 ? slug(rel === null ? "senza-release" : rel) + "/" : "";
      files.push({ name: dir + "piano-di-test.md", text: p.md });
      for (const t of p.tickets) { const s = sheet(t, ctx); files.push({ name: dir + "schede/" + s.name, text: s.md }); sheets++; }
    }
    return { files, sheets };
  }

  // zip senza compressione (metodo STORE): poche righe, nessuna libreria esterna
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(files, date = new Date()) {
    const enc = new TextEncoder(), parts = [], central = [];
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, dosTime, 2], [12, dosDate, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, name.length, 2], [28, 0, 2]].forEach(([o, v, s]) => (s === 4 ? lh.setUint32(o, v, true) : lh.setUint16(o, v, true)));
      const ch = new DataView(new ArrayBuffer(46));
      [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, dosTime, 2], [14, dosDate, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, name.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, off, 4]].forEach(([o, v, s]) => (s === 4 ? ch.setUint32(o, v, true) : ch.setUint16(o, v, true)));
      parts.push(new Uint8Array(lh.buffer), name, data);
      central.push(new Uint8Array(ch.buffer), name);
      off += 30 + name.length + data.length;
    }
    const size = central.reduce((a, b) => a + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, files.length, 2], [10, files.length, 2], [12, size, 4], [16, off, 4], [20, 0, 2]].forEach(([o, v, s]) => (s === 4 ? end.setUint32(o, v, true) : end.setUint16(o, v, true)));
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
    let p = 0;
    for (const b of all) { out.set(b, p); p += b.length; }
    return out;
  }

  W.QA = { sections, sheet, plan, bundle, zip, crc32, slug, testOrder };
})(typeof window !== "undefined" ? window : globalThis);
