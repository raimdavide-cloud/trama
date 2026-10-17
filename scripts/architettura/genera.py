# Genera public/architettura.html: la pagina dell'architettura per chi la presenta a un pubblico tecnico.
# I diagrammi di sequenza sono HTML statico (griglia CSS), così la pagina è completa senza JavaScript.
# Uso: python3 scripts/architettura/genera.py   (poi npm run check)
from html import escape as e
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# ---------- diagrammi di sequenza ----------
# Ogni messaggio: (da, a, testo, tipo) con tipo "" (chiamata), "r" (risposta), "t" (il filo: dati del backlog), "n" (nota su un partecipante)
def seq(sid, title, parts, msgs, caption):
    n = len(parts)
    head = "".join(f'<div class="ax-sp" style="grid-column:{i+1}">{e(p)}</div>' for i, p in enumerate(parts))
    lifes = "".join(f'<div class="ax-life" style="grid-column:{i+1};grid-row:2 / span {len(msgs)}" aria-hidden="true"></div>' for i in range(n))
    rows, items = [], []
    for k, (a, b, text, kind) in enumerate(msgs, start=2):
        if kind == "n" or a == b:
            rows.append(f'<div class="ax-note" style="grid-column:{a+1};grid-row:{k}">{text}</div>')
            continue
        lo, hi = min(a, b), max(a, b)
        span = hi - lo + 1
        cls = "ax-msg" + (" rev" if b < a else "") + (" ret" if kind == "r" else "") + (" thr" if kind == "t" else "")
        rows.append(f'<div class="{cls}" style="grid-column:{lo+1} / span {span};grid-row:{k};--span:{span}"><span>{text}</span></div>')
        items.append(f"<li>{e(parts[a])} → {e(parts[b])}: {text}</li>")
    return f'''<figure class="ax-seq-fig" id="{sid}">
  <figcaption><h3>{e(title)}</h3><p>{caption}</p></figcaption>
  <div class="ax-seq-wrap" role="img" tabindex="0" aria-label="Diagramma di sequenza: {e(title)}"><div class="ax-seq" style="--n:{n}">{head}{lifes}{"".join(rows)}</div></div>
  <details class="ax-seq-text"><summary>Versione testuale</summary><ol>{"".join(items)}</ol></details>
</figure>'''

SEQ_LOGIN = seq("seq-accesso", "Accesso con Atlassian (OAuth 2.0, 3LO)",
  ["Browser", "/api", "auth.atlassian.com", "api.atlassian.com", "Postgres"],
  [
    (0, 1, "GET <code>/api/auth/login</code>", ""),
    (1, 0, "302 + cookie <code>bs_oauth_state</code> (anti-CSRF)", "r"),
    (0, 2, "<code>/authorize</code> · scope Jira + <code>offline_access</code> · <code>prompt=consent</code>", ""),
    (2, 0, "302 <code>/api/auth/callback?code&amp;state</code>", "r"),
    (0, 1, "callback: <code>state</code> confrontato con il cookie", ""),
    (1, 2, "<code>POST /oauth/token</code> (client secret, solo lato server)", ""),
    (1, 3, "<code>accessible-resources</code> → siti Jira; <code>/myself</code>", ""),
    (1, 4, "upsert <code>users</code>: token cifrati AES-256-GCM", ""),
    (1, 4, "insert <code>sessions</code>: SHA-256 dell'id", ""),
    (1, 0, "302 verso l'app (<code>/studio</code>) + cookie <code>bs_session</code> (256 bit, HttpOnly, SameSite=Lax, Secure, 30 gg)", "r"),
  ],
  "Il token Atlassian non arriva mai al browser: resta cifrato nel database e la funzione lo rinnova da sola quando manca meno di un minuto alla scadenza. A ogni rinnovo si aggiorna anche l'elenco dei siti a cui l'utente accede.")

SEQ_SYNC = seq("seq-dati", "Lettura, scrittura e sincronizzazione dei dati",
  ["Trama (browser)", "Runtime dati", "/api", "Postgres"],
  [
    (1, 2, "<code>GET /api/projects/:id</code> (stato completo all'apertura)", ""),
    (2, 3, "<code>items</code> non eliminati + <code>clock_timestamp()</code>", ""),
    (0, 0, "modifica: aggiornamento immediato dell'interfaccia", "n"),
    (0, 1, "<code>set</code>/<code>delete</code> di più documenti nello stesso istante", ""),
    (1, 1, "raggruppa (≤ 500 operazioni, ≤ 3,5 MB); un gruppo alla volta, in ordine", "n"),
    (1, 2, "<code>POST /api/projects/:id/batch</code> (o <code>PUT</code> se è uno solo)", ""),
    (2, 3, "una query: <code>jsonb_to_recordset</code> + <code>ON CONFLICT</code>", ""),
    (1, 2, "ogni 6 s (30 s dopo 2 min fermi): <code>GET …?since=t</code>", ""),
    (2, 1, "delta da <code>t − 3 s</code>, eliminazioni comprese", "r"),
    (1, 0, "notifica solo le raccolte cambiate; i documenti in volo non vengono sovrascritti", "r"),
  ],
  "Consistenza finale con ultima scrittura vincente per documento. La finestra di 3 secondi sul <code>since</code> assorbe le differenze di orologio; se si chiude la scheda con salvataggi in volo il browser chiede conferma.")

SEQ_CLAUDE = seq("seq-claude", "Una richiesta a Claude",
  ["Trama (browser)", "Ponte (127.0.0.1:8790)", "Claude Code"],
  [
    (0, 1, "<code>GET /health</code> ogni 10 s: ponte attivo e accesso a Claude", ""),
    (0, 1, "<code>POST</code> con <code>Origin</code> del sito (+ <code>x-bridge-token</code> se impostato)", ""),
    (1, 1, "<code>Origin</code> fuori elenco → 403; al massimo 2 richieste in parallelo", "n"),
    (1, 2, "<code>claude -p --tools \"\"</code> in una cartella temporanea vuota", ""),
    (2, 1, "<code>stream-json</code>", "r"),
    (1, 0, "eventi nel formato dell'API Messages (streaming), timeout 10 min", "r"),
    (0, 0, "proposte strutturate: l'utente le applica una per una", "n"),
  ],
  "Nessuna chiave Anthropic nel server: ogni persona usa il proprio abbonamento Claude Code. Il ponte ascolta solo sull'interfaccia di loopback e risponde agli header di Private Network Access.")

SEQ_JIRA = seq("seq-jira", "Creazione su Jira, idempotente",
  ["Trama (browser)", "/api", "Jira Cloud"],
  [
    (0, 1, "controllo: configurazione, campi obbligatori, JQL dei duplicati", ""),
    (1, 2, "REST v3 (lettura) con il token dell'utente", ""),
    (0, 1, "struttura: Project → Fase → Feature Epic (padre del livello giusto)", "t"),
    (1, 2, "<code>POST /rest/api/2/issue</code> · solo campi ammessi", "t"),
    (2, 1, "5xx o timeout: esito incerto", "r"),
    (0, 1, "JQL <code>summary ~</code> + <code>created &gt;= -20m</code>: se c'è, lo riusa", ""),
    (0, 1, "ticket: uno per volta; esito incerto → stato «da verificare», si ferma", "t"),
    (0, 1, "collegamenti con le chiavi reali (<code>issueLink</code>)", ""),
    (0, 1, "verifica: rilegge ogni ticket e i suoi campi", ""),
    (0, 0, "«Cerca in Jira» riconcilia un ticket incerto senza crearne un altro", "n"),
  ],
  "La descrizione viaggia in wiki markup (API v2) per restare leggibile in Jira; il resto usa la v3. Un 401 provoca un rinnovo del token e un secondo tentativo; 429 e 5xx tornano come errori temporanei.")

# ---------- pagina ----------
def table(head, rows, cls="ax-t"):
    th = "".join(f"<th scope=\"col\">{h}</th>" for h in head)
    tr = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
    return f'<div class="ax-tw" tabindex="0" role="region" aria-label="Tabella"><table class="{cls}"><thead><tr>{th}</tr></thead><tbody>{tr}</tbody></table></div>'

COMPONENTS = table(["Componente", "Tecnologia", "Responsabilità", "Stato"], [
  ["<b>Trama (app)</b><br><code>/studio</code>", "HTML + JavaScript senza framework né build; 242 KB (83 KB Brotli)", "Interfaccia dei 6 passi, regole del playbook, validazione dei ticket, piano di creazione, orchestrazione delle chiamate Jira", "In memoria; preferenze in <code>localStorage</code>"],
  ["<b>Runtime dati</b><br><code>studio-runtime.js</code>", "Livello dati con interfaccia <code>doc</code>/<code>collection</code>/<code>onSnapshot</code>", "Snapshot iniziale, scritture raggruppate, sincronizzazione a intervallo adattivo, chiamate <code>/api</code>, ponte Claude", "Coda delle scritture in volo"],
  ["<b>Estrazione documenti</b>", "mammoth 1.6 (Word), pdf.js 3.11 (PDF), SheetJS 0.18 (Excel) da cdnjs, caricati al primo uso", "Testo estratto nel browser; si salva solo il testo (≤ 110.000 caratteri per documento)", "Nessun file sul server"],
  ["<b>Pagine statiche</b>", "Vercel, <code>cleanUrls</code>, region <code>fra1</code>", "Home, guida al ponte, marchio, componenti, privacy, architettura", "—"],
  ["<b>Funzione <code>/api</code></b><br><code>api/router.mjs</code>", "Node 22, un'unica funzione con instradamento per <code>config.path</code>; <code>maxDuration</code> 60 s", "Sessioni, progetti e documenti, salvataggio in blocco, operazioni Jira da un elenco chiuso", "Senza stato"],
  ["<b>Cron privacy</b>", "Vercel Cron, ogni giorno alle 03:00 UTC, con <code>CRON_SECRET</code>", "Personal Data Reporting API di Atlassian; cancella i dati degli account chiusi", "—"],
  ["<b>Database</b>", "Neon Postgres, <code>eu-central-1</code>, driver serverless su HTTPS (pooler)", "Utenti e token cifrati, sessioni, progetti, documenti JSONB", "Persistente"],
  ["<b>Ponte Claude</b><br><code>trama-ponte.mjs</code>", "Node, server HTTP su <code>127.0.0.1:8790</code>, scaricabile da <code>/installazione</code>", "Inoltra le richieste a <code>claude -p</code> e restituisce lo streaming", "Senza stato"],
  ["<b>Atlassian</b>", "OAuth 2.0 (3LO); Jira Cloud REST v3 e v2 via <code>api.atlassian.com/ex/jira/{cloudId}</code>", "Identità, siti accessibili, lettura e scrittura dei ticket, segnalazione dati personali", "Esterno"],
])

DATA = table(["Tabella", "Chiave", "Contenuto", "Note"], [
  ["<code>users</code>", "<code>account_id</code> (Atlassian)", "nome, email, avatar, <code>access_token</code> e <code>refresh_token</code> cifrati, <code>expires_at</code>, <code>sites</code> (JSONB)", "cancellati con <code>DELETE /api/me</code> o quando l'account Atlassian viene chiuso"],
  ["<code>sessions</code>", "<code>id_hash</code> = SHA-256 dell'id nel cookie", "<code>account_id</code>, scadenza a 30 giorni", "a cascata con <code>users</code>"],
  ["<code>projects</code>", "<code>id</code> casuale (72 bit)", "nome, <code>cloud_id</code> del sito Atlassian, autore", "indice su <code>cloud_id</code>: è il confine di isolamento"],
  ["<code>items</code>", "<code>(project_id, col, id)</code>", "un documento JSONB per requisito, ticket, domanda, decisione, documento, metadato", "indice <code>(project_id, updated_at)</code> per il delta; eliminazione logica"],
])

COLLECTIONS = table(["Raccolta (<code>col</code>)", "Documenti"], [
  ["<code>meta</code>", "<code>project</code>, <code>kit</code> (release = Fasi, epiche, struttura, label), <code>jira</code> (configurazione letta), <code>chat</code>, <code>runlog</code>, <code>quality</code>, <code>sprints</code>"],
  ["<code>docs</code>", "testo estratto dai documenti caricati"],
  ["<code>reqs</code>", "requisiti con ID stabile, release, componenti, note UX, dipendenze, domande"],
  ["<code>questions</code>", "domande di apertura con risposta o ipotesi"],
  ["<code>tickets</code>", "ticket con tipo, area, epica, release, label, modello di descrizione, collegamenti, stato di creazione e chiave Jira"],
  ["<code>decisions</code>", "registro delle decisioni con fonte e impatto"],
])

SECURITY = table(["Minaccia", "Controllo", "Dove"], [
  ["Furto o riuso della sessione", "Cookie <code>HttpOnly</code>, <code>SameSite=Lax</code>, <code>Secure</code>; id a 256 bit salvato solo come SHA-256; scadenza 30 giorni", "<code>core.mjs</code>"],
  ["CSRF", "Le richieste che modificano dati devono avere <code>Origin</code> uguale al sito; <code>state</code> nel login OAuth", "<code>sameOrigin()</code>, callback"],
  ["Accesso ai progetti di altri", "Ogni progetto appartiene a un sito Atlassian; si vede solo se il <code>cloud_id</code> è tra i siti dell'utente (aggiornati a ogni rinnovo del token)", "<code>loadProject()</code>"],
  ["Uso improprio di Jira tramite il server", "Elenco chiuso di 11 operazioni; chiavi validate con espressione regolare; solo i campi <code>components</code>, <code>labels</code>, <code>parent</code>, <code>priority</code>, <code>customfield_*</code>; il <code>cloudId</code> deve essere un sito dell'utente", "<code>jira-ops.mjs</code>, <code>jira.mjs</code>"],
  ["Token Atlassian esposti", "Cifrati con AES-256-GCM (IV casuale); la chiave sta solo nelle variabili d'ambiente; mai inviati al browser", "<code>seal()</code>/<code>unseal()</code>"],
  ["Input malevolo o eccessivo", "Raccolte e id validati; 1 MB per documento; 4 MB e 500 operazioni per gruppo; un'operazione non valida fa rifiutare tutto il gruppo", "<code>project.mjs</code>"],
  ["Abuso del ponte Claude", "Solo loopback; <code>Origin</code> in elenco; token opzionale; Claude senza strumenti in una cartella vuota", "<code>claude-bridge.mjs</code>"],
  ["Segreti nel codice", "Controllo automatico a ogni commit (chiavi Anthropic e Atlassian, stringhe di connessione, chiavi private)", "<code>npm run check</code>"],
  ["Dati personali", "Segnalazione giornaliera ad Atlassian; cancellazione su richiesta o ad account chiuso; i progetti restano senza riferimento all'autore", "<code>privacy.mjs</code>"],
])

ADR = [
  ("Trama senza framework né build", "Un solo file HTML con JavaScript vanilla, servito statico.", "Nessuna catena di build da mantenere, avvio immediato, pagina ispezionabile. In cambio: disciplina manuale su stato e ridisegno, mitigata da memoizzazione per versione dei dati e da 44 test end-to-end."),
  ("Claude dal computer dell'utente", "Un ponte locale invoca Claude Code con l'abbonamento della persona.", "Nessuna chiave né costo API centrale, nessun testo dei documenti che passa dal server. Richiede di installare Claude Code e avviare il ponte; senza ponte Trama funziona, ma senza proposte di Claude."),
  ("Documenti JSONB invece di tabelle per entità", "Una tabella <code>items</code> con chiave <code>(project, raccolta, id)</code>.", "Il modello evolve senza migrazioni (per esempio UX Story al posto di Spike è stata una conversione nel client). Niente vincoli referenziali tra requisiti e ticket: li verifica Trama."),
  ("Sincronizzazione a polling", "Delta per <code>updated_at</code> ogni 6 s, 30 s da fermi.", "Compatibile con funzioni serverless senza connessioni persistenti. Latenza di collaborazione fino a 30 s, costo proporzionale alle schede aperte."),
  ("Una sola funzione per tutte le API", "<code>api/router.mjs</code> instrada verso gestori dichiarativi.", "Un solo avvio a freddo da scaldare, un solo punto per i controlli trasversali; i gestori restano piccoli e testabili."),
  ("Jira simulato nei test", "Un Jira finto in memoria che rispetta i livelli Project › Fase › Epica › ticket e accetta guasti su richiesta.", "Test completi della creazione, anche con risposte perse, senza toccare un Jira vero e senza account."),
]

LIMITS = [
  ("Nessuna Content-Security-Policy", "Le pagine inviano <code>nosniff</code>, <code>X-Frame-Options: DENY</code> e <code>Referrer-Policy</code>, ma non una CSP. Trama carica librerie da cdnjs: una CSP con elenco di origini è il prossimo passo."),
  ("Ultima scrittura vincente", "Due persone sullo stesso documento nello stesso intervallo: vince l'ultima. Possibile evoluzione: versione per documento e conflitto esplicito."),
  ("Stato completo all'apertura", "Il progetto si carica intero (circa 270 KB nel progetto di prova), testo dei documenti compreso. Possibile evoluzione: testo dei documenti su richiesta."),
  ("Polling invece di push", "Fino a 30 secondi per vedere le modifiche di un collega fermo da più di 2 minuti."),
  ("Limiti di Jira gestiti in modo semplice", "429 e 5xx tornano come errori temporanei; non c'è un'attesa esponenziale automatica tra un tentativo e l'altro."),
  ("Eliminazioni logiche mai ripulite", "Le righe eliminate restano marcate in <code>items</code>; servirà una pulizia periodica."),
]

def adr_cards():
    return "".join(f'<article class="ax-card"><h3>{e(t)}</h3><p><b>Decisione.</b> {d}</p><p><b>Conseguenze.</b> {c}</p></article>' for t, d, c in ADR)

def limit_items():
    return "".join(f"<li><b>{t}.</b> {d}</li>" for t, d in LIMITS)

SVG = (ROOT / "scripts/architettura/container.svg").read_text()

TOC = [("contesto", "Contesto e container"), ("componenti", "Componenti"), ("flussi", "Flussi"), ("dati", "Dati e consistenza"), ("sicurezza", "Sicurezza"), ("qualita", "Qualità misurata"), ("decisioni", "Decisioni"), ("limiti", "Limiti noti")]

page = f'''<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Architettura · Trama</title>
<meta name="description" content="Architettura di Trama per un pubblico tecnico: container, componenti, flussi, dati, sicurezza, qualità, decisioni e limiti noti.">
<meta name="robots" content="noindex">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=Figtree:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap">
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/studio.css">
<link rel="stylesheet" href="/architettura.css">
</head>
<body>
<div class="ax-wrap">
<header class="ax-top">
  <a class="brand" href="/" style="text-decoration:none;color:inherit"><span class="wm" aria-hidden="true"><svg class="wm-t" viewBox="0 0 21 47" aria-hidden="true" focusable="false"><use href="/icons.svg#tx-t" width="21" height="47"/></svg>rama</span><span class="sr-only">Trama, home</span></a>
  <nav aria-label="Documentazione"><a href="/componenti">Componenti</a><a href="/architettura" aria-current="page">Architettura</a><a href="/studio">Apri Trama</a></nav>
</header>
<main class="ax-main">
<header class="ax-hero">
  <div class="eyebrow">Architettura</div>
  <h1>Come è fatta Trama</h1>
  <p class="ax-lead">Trama trasforma documenti di requisiti in un backlog Jira strutturato (Project › Fase › Epica › ticket) seguendo un playbook PO+AI. Gira nel browser come applicazione a pagina singola; il server è una funzione serverless senza stato che conserva i dati del progetto e chiama Jira con i permessi dell'utente; Claude risponde dal computer dell'utente tramite un ponte locale.</p>
  <dl class="ax-facts">
    <div><dt>Front-end</dt><dd>HTML + JS senza framework</dd></div>
    <div><dt>Back-end</dt><dd>Node 22 · Vercel · fra1</dd></div>
    <div><dt>Dati</dt><dd>Postgres Neon · eu-central-1</dd></div>
    <div><dt>Identità</dt><dd>Atlassian OAuth 2.0 (3LO)</dd></div>
    <div><dt>AI</dt><dd>Claude Code via ponte locale</dd></div>
  </dl>
  <nav class="ax-toc" aria-label="In questa pagina">{"".join(f'<a href="#{i}">{t}</a>' for i, t in TOC)}</nav>
</header>

<section id="contesto" class="ax-sec">
  <div class="ax-h"><span class="eyebrow">1 · Contesto e container</span><h2>Tre zone di fiducia</h2>
  <p>Il computer dell'utente (browser e ponte), la piattaforma Vercel (pagine e funzione) e i servizi gestiti (Neon e Atlassian). La linea zafferano segue un requisito dal documento al ticket in Jira.</p></div>
  <div class="ax-diagram" role="img" tabindex="0" aria-label="Diagramma dei container: computer dell'utente con Trama nel browser, ponte Claude su 127.0.0.1:8790 e Claude Code; Vercel fra1 con pagine statiche, funzione /api e cron privacy; servizi esterni Neon Postgres eu-central-1 e Atlassian (OAuth 2.0, Jira Cloud REST, Personal Data Reporting).">{SVG}</div>
</section>

<section id="componenti" class="ax-sec">
  <div class="ax-h"><span class="eyebrow">2 · Componenti</span><h2>Cosa fa ogni pezzo</h2></div>
  {COMPONENTS}
</section>

<section id="flussi" class="ax-sec">
  <div class="ax-h"><span class="eyebrow">3 · Flussi</span><h2>I quattro percorsi che contano</h2>
  <p>Linea continua: chiamata. Tratteggio: risposta. Zafferano: scrittura del backlog in Jira. Riquadro: elaborazione locale.</p></div>
  <div class="ax-flows">{SEQ_LOGIN}{SEQ_SYNC}{SEQ_CLAUDE}{SEQ_JIRA}</div>
</section>

<section id="dati" class="ax-sec">
  <div class="ax-h"><span class="eyebrow">4 · Dati e consistenza</span><h2>Quattro tabelle, un documento per elemento</h2>
  <p>Il confine di isolamento è il sito Atlassian: chi accede allo stesso sito vede gli stessi progetti. Il modello è documentale (JSONB) e si evolve senza migrazioni.</p></div>
  {DATA}
  <h3 class="ax-h3">Raccolte dentro <code>items</code></h3>
  {COLLECTIONS}
  <ul class="ax-list">
    <li><b>Consistenza.</b> Finale, con ultima scrittura vincente per documento. Le scritture dello stesso istante partono in un gruppo; i gruppi partono in ordine, uno alla volta.</li>
    <li><b>Delta.</b> <code>updated_at</code> da <code>clock_timestamp()</code>; il client chiede le modifiche dal momento dell'ultima risposta meno 3 secondi.</li>
    <li><b>Eliminazioni.</b> Logiche (<code>deleted = true</code>), così arrivano anche agli altri client tramite il delta.</li>
    <li><b>Residenza.</b> Funzione e database a Francoforte; i file restano sul computer dell'utente.</li>
  </ul>
</section>

<section id="sicurezza" class="ax-sec">
  <div class="ax-h"><span class="eyebrow">5 · Sicurezza</span><h2>Minacce e controlli</h2></div>
  {SECURITY}
</section>

<section id="qualita" class="ax-sec">
  <div class="ax-h"><span class="eyebrow">6 · Qualità misurata</span><h2>Numeri, non aggettivi</h2>
  <p>Misure con <code>npm run perf</code> sul simulatore; latenze dalla produzione.</p></div>
  <div class="ax-metrics">
    <div><b>9 ms</b><span>ridisegno del Backlog con 67 ticket (prima 675 ms)</span></div>
    <div><b>19 ms</b><span>ridisegno del Backlog con 268 ticket (prima 4,6 s)</span></div>
    <div><b>2</b><span>richieste per rinominare una release su 130 elementi (prima 133)</span></div>
    <div><b>110–150 ms</b><span>risposta della funzione da Vercel fra1, senza database</span></div>
    <div><b>~40 ms</b><span>query a Neon dall'Italia; ~0,5 s al risveglio</span></div>
    <div><b>0,6 s</b><span>primo disegno della home su 4G simulato</span></div>
  </div>
  <div class="ax-two">
    <div class="ax-card"><h3>Test a ogni modifica</h3><ul class="ax-list">
      <li><b>27 unitari</b>: router, sessioni e cifratura, API dei dati con database finto, operazioni Jira.</li>
      <li><b>44 end-to-end</b> con Playwright su un simulatore completo: Trama vera, API in memoria, Jira finto con guasti su richiesta (risposta persa dopo la creazione, 500 prima della creazione).</li>
      <li><b>Accessibilità</b> WCAG 2.2 AA con axe, anche in modalità scura; allineamento delle icone misurato.</li>
      <li><b>25 confronti visivi</b> pixel per pixel, in locale.</li>
    </ul></div>
    <div class="ax-card"><h3>Dal commit alla produzione</h3><ol class="ax-steps">
      <li>Pull request su GitHub (repository privato).</li>
      <li>GitHub Actions: <code>npm run check</code> (sintassi, segreti, token di design), test unitari, test end-to-end.</li>
      <li>Anteprima su Vercel per ogni pull request.</li>
      <li>Produzione solo da <code>main</code> e solo con i test superati (<code>vercel deploy --prebuilt --prod</code>), poi controllo degli indirizzi.</li>
      <li>Le pubblicazioni automatiche di Vercel da Git sono spente: non si va in produzione senza i test.</li>
    </ol></div>
  </div>
</section>

<section id="decisioni" class="ax-sec">
  <div class="ax-h"><span class="eyebrow">7 · Decisioni</span><h2>Scelte e compromessi</h2></div>
  <div class="ax-cards">{adr_cards()}</div>
</section>

<section id="limiti" class="ax-sec">
  <div class="ax-h"><span class="eyebrow">8 · Limiti noti</span><h2>Cosa non fa ancora</h2></div>
  <ul class="ax-list ax-limits">{limit_items()}</ul>
</section>
</main>
<footer class="ax-foot">Trama · architettura aggiornata a ottobre 2026. Fonte: il codice del repository; numeri da <code>npm run perf</code> e dalla produzione.</footer>
</div>
</body>
</html>
'''
(ROOT / "public/architettura.html").write_text(page)
print("scritto public/architettura.html", len(page), "caratteri")
