/* Scheda QA: dal ticket e da ciò che lo circonda (requisito, dipendenze, registro decisioni) un Markdown pronto per chi collauda.
   Trama lo allega alle storie su Jira alla fine della creazione. Funzioni pure sui dati: le usano Trama e i test unitari.
   I titoli delle sezioni passano da ctx.tr (la lingua dell'interfaccia); i contenuti restano nella lingua in cui sono scritti. */
(function (W) {
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
  const mentions = (hay, codes) => codes.filter(Boolean).some((c) => new RegExp("(^|[^A-Za-z0-9-])" + c.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&") + "(?![A-Za-z0-9-]|-\\d)").test(hay));
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

  W.QA = { sections, sheet, slug };
})(typeof window !== "undefined" ? window : globalThis);
