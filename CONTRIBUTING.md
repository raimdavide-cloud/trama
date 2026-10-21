# Lavorare su Trama

Come si lavora sul repository: dal ramo alla produzione, i test da far passare e le regole che il codice di Trama rispetta.
Per installare e avviare Trama vedi il [README](README.md); per nome, colori e tono di voce vedi [BRAND.md](BRAND.md).

## In breve

1. Parti da `main` aggiornato e apri un ramo tuo.
2. Fai un cambiamento alla volta, con i test.
3. Prima della PR: `npm run check`, `npm test`, le traduzioni e, se cambia l'interfaccia, i test visivi.
4. Apri la PR: la CI rifà i controlli e pubblica un'anteprima.
5. Unisce in `main` solo Davide: **unire in `main` vuol dire pubblicare in produzione**.

## Prima di iniziare

- Node 22 o più recente e Google Chrome installato (i test in locale usano il Chrome del computer).
- `npm ci` installa le dipendenze. Per i test **non servono** `.env`, database o account Atlassian: girano contro il simulatore.
- Per guardare Trama con i dati di prova senza toccare nulla di vero: `npm run sim`, poi apri http://127.0.0.1:8899/studio?p=progetto-prova.
- `.env` e i file `.env.*` restano solo sul tuo computer. Non si chiedono, non si incollano in chat o nelle PR.

## Flusso di lavoro

```bash
git checkout main && git pull --ff-only
git checkout -b area/cosa-cambia      # es. backlog/filtro-epiche, home/faq-qa, fix/toast-annulla
```

- **Un ramo per argomento, PR piccole.** Una PR che tocca tre funzioni diverse è difficile da rivedere e da annullare.
- **Mai push diretto su `main`.** Ogni push su `main` va in produzione dopo la CI.
- **Mai `--force` su un ramo che qualcun altro usa.** Sul tuo ramo, prima di aprire la PR, va bene un rebase.
- **File «caldi».** `public/studio-app.js`, `public/i18n-en.js` e `public/studio.css` li toccano quasi tutte le modifiche. Se lavoriamo in parallelo sulla stessa parte, avvisiamoci prima per evitare conflitti grossi.
- **Prima di unire:** se `main` è andato avanti, aggiorna il ramo (`git merge origin/main` o rebase), rilancia i test e lascia che la CI rigiri sulla versione aggiornata.
- **Messaggi di commit in italiano:** una riga che dice cosa cambia per chi usa Trama (es. «Backlog: ricerca per epica nella lista dei ticket»). Se serve, aggiungi sotto un elenco di dettagli.
- **La PR** dice cosa cambia, perché, come l'hai provato e cosa resta fuori. Il modello in `.github/pull_request_template.md` ha la lista dei controlli.

### Cosa succede dopo la PR

La CI (`.github/workflows/ci.yml`) esegue controlli, test unitari e end-to-end. Se passano, pubblica un'**anteprima** su Vercel, protetta dall'accesso Vercel. Dopo l'unione in `main` rifà i test e pubblica in **produzione** (https://trama-backlog.vercel.app); un ultimo passo controlla che le pagine principali rispondano.

## Test

| Comando | Cosa controlla | Quando |
| --- | --- | --- |
| `npm run check` | Sintassi di tutto il JavaScript, niente script dentro le pagine HTML (CSP), JSON validi, ponte scaricabile allineato, colori solo dai token, nessun segreto nei file | Sempre |
| `npm run test:unit` | Server, API dei dati, operazioni Jira contro il Jira finto, Scheda QA, versioni dei file | Sempre |
| `npm run test:e2e` | Trama nel browser contro il simulatore: percorso completo, flussi, Jira con errori simulati, accessibilità (axe, WCAG 2.2 AA), inglese, homepage | Sempre |
| `npm run i18n:mancanti` | Testi dell'interfaccia di Trama senza traduzione inglese | Se aggiungi o cambi testi in Trama |
| `npm run i18n:mancanti-home` | Testi della homepage senza traduzione inglese | Se tocchi la homepage |
| `npm run test:visual` | Confronto con le immagini di riferimento (solo in locale, non in CI) | Se cambia qualcosa che si vede |
| `npm run perf` | Tempi di ridisegno e salvataggi con 67, 134 e 268 ticket | Se tocchi liste, controlli o salvataggi |
| `npm run design` | Rilevatore di problemi di design ([Impeccable](https://impeccable.style)): 61 controlli fissi su pagine e fogli di stile, senza intelligenza artificiale. Esce con 2 se ci sono segnalazioni | Se tocchi pagine o stili: guarda se ne arrivano di nuove |
| `npm run design:riepilogo` | Le stesse segnalazioni raggruppate per regola e per file. In CI compaiono nel riepilogo del lavoro e **non bloccano** | Per confrontare prima e dopo |
| `npm run perf:aggancio` | Aggancio delle sezioni della homepage con uno scorrimento da trackpad: inversioni, fotogrammi, tempi | Se tocchi lo scorrimento della homepage |

- `npm test` esegue unitari ed end-to-end insieme.
- I test end-to-end avviano da soli un simulatore sulla porta 8899. Se ne hai già uno aperto (`npm run sim`), lancia i test su un'altra porta, per esempio `SIM_PORT=8897 npm run test:e2e`, così non si pestano i dati.
- **Test visivi:** dopo un cambiamento voluto, `npm run test:visual -- --update-snapshots`. Poi **guarda le immagini aggiornate** in `tests/visual/riferimenti` prima del commit: si aggiornano solo quelle che dovevano cambiare.
- **Ogni funzione nuova arriva con il suo test.**
  - Un'operazione verso Jira ha il test unitario contro il Jira finto (`tests/sim/fake-jira.mjs`), da estendere se serve.
  - Un comportamento dell'interfaccia ha il test end-to-end, con gli aiuti comuni in `tests/e2e/aiuti.mjs`.
  - Le risposte di Tessa nei test si simulano sostituendo `window.ask`: c'è un esempio in `tests/e2e/produttivita.spec.mjs`.
- Il simulatore accetta guasti su richiesta (`POST /__sim/fault`) e l'intestazione `x-sim-by` per simulare un collega che salva.

## Regole del progetto

### Testi e lingua

- **Si dice sempre «Trama».** La parola «studio» non compare nei testi visibili.
- **Nella chat l'assistente è Tessa**, e Claude non si nomina mai. Fuori dalla chat: «Tessa» dove si parla di cosa fa; «Claude Code» solo dove si spiega il funzionamento tecnico (ponte, sicurezza, installazione).
- Tono da [BRAND.md](BRAND.md): frasi brevi, voce attiva, la cosa più importante prima. Gli errori dicono cosa è successo e cosa fare. Niente emoji né enfasi.
- **I testi si scrivono in italiano nel codice.** Ogni testo nuovo ha la sua traduzione in `public/i18n-en.js` (Trama) o `public/i18n-home-en.js` (homepage). I test falliscono se ne manca una.
  - **Voci esatte** per i testi fissi.
  - **Modelli** con `{n}` per i numeri, `{q}` per ogni nome tra «» (anche le parole fisse tra «» diventano `{q}`), `{k}` per le chiavi come RF-012.
  - **`{*}` solo dove serve testo libero**, e mai in regole generiche come `"{*} e {*}"`: finirebbero per tradurre anche i dati.
- **I dati del progetto non si traducono**: requisiti, ticket, nomi, contenuti dei documenti. Mettili dentro un elemento con `data-no-i18n`.

### Interfaccia

- **Solo computer**: finestra larga almeno 900 pixel. Telefono e tablet non si supportano e non si provano.
- **Colori solo dai token** di `public/tokens.css` (chiaro e scuro): niente esadecimali nei fogli di stile.
- **Accessibilità WCAG 2.2 AA:**
  - etichette per i comandi;
  - focus visibile;
  - tastiera completa (Invio, frecce, Esc);
  - niente comandi interattivi annidati.

  Lo controlla axe nei test.
- **Azioni che cancellano o scrivono fuori** (eliminazioni, scritture su Jira): conferma a due clic (`arm`) e, dove si può, «Annulla» subito dopo (`trash`, `toast` con annullamento).
- **Prima di aggiungere un pulsante, chiediti se ne esiste già uno che fa la stessa cosa:** meglio un menu che tre pulsanti in fila.

### Jira

- **Trama non cancella nulla in Jira.** Scrive solo dopo un controllo e la conferma di chi usa Trama, e poi rilegge Jira per verificare.
- Le operazioni verso Jira stanno in `server/lib/jira-ops.mjs`:
  - si accettano solo i campi ammessi;
  - chiavi e label si validano prima di chiamare Jira;
  - ogni operazione ha il suo test unitario.

### Dati, privacy, sicurezza

- **Una nuova raccolta di dati** va dichiarata in `server/functions/project.mjs` (`COLS`). I contenuti pesanti si caricano solo quando servono (`server/lib/lazy.mjs`).
- **Dati personali nuovi** (anche solo un nome):
  - aggiorna la tabella in `public/privacy.html`;
  - aggiorna la cancellazione in `server/lib/privacy.mjs` (`erasePerson`).
- **Content-Security-Policy** (`vercel.json`):
  - niente JavaScript dentro le pagine HTML;
  - niente risorse da altri domini, tranne le librerie già usate da cdnjs;
  - i font sono serviti da Trama.
- **I riferimenti a script, stili, icone e font si scrivono con il percorso assoluto** (`/file.js`, `/icons.svg#i-…`). Nella build `scripts/versioni.mjs` aggiunge l'impronta `?v=…` che permette la cache lunga.
- **Nessun segreto** nel codice, nei test, nei log o nelle PR. `npm run check` blocca i casi più comuni, ma non basta da solo.
- **Il database di produzione non si usa per provare:** per tutto c'è il simulatore.

### Codice

- **Segui lo stile del file che stai modificando.** Codice compatto; commenti in italiano che spiegano il *perché*, non il *cosa*.
- **Nessuna dipendenza nuova senza parlarne prima:** oggi in produzione ce n'è una sola (`@neondatabase/serverless`). Di sviluppo: Playwright, axe e Impeccable (quest'ultimo con versione esatta, perché le sue regole cambiano tra una versione e l'altra).
- **Il server gira su Vercel** (Node 22, Francoforte): funzioni in `server/functions`, instradate da `api/router.mjs`.

## Strumenti per Claude Code (facoltativo)

Se lavori con Claude Code sul progetto puoi installare la skill di design [Impeccable](https://impeccable.style) (comandi come `/impeccable critique`, `/audit`, `/polish`, `/typeset`):

```bash
npx impeccable install -y --providers=claude --scope=project --no-hooks
```

- La skill va in `.claude/`, che **non è nel repository**: ognuno la installa sul proprio computer. Ricarica Claude Code dopo l'installazione.
- **Senza hook** (`--no-hooks`): niente controlli automatici a ogni modifica dei file. Se li vuoi, attivali tu sul tuo computer, non nel progetto.
- Il contesto di design (`PRODUCT.md`, `DESIGN.md`, con `/impeccable init`) invece sta nel repository e vale per tutti.
- La versione è quella fissa in `package.json`; per aggiornarla si cambia lì e poi `npx impeccable update`.
- Le segnalazioni del rilevatore sono indizi, non sentenze: alcune sono scelte del nostro stile (etichette numerate, riquadri icona) o letture sbagliate (immagini con indirizzo impostato da script). Se un giorno il controllo diventerà bloccante, quelle accettate andranno in un elenco di esclusioni (`npx impeccable ignores`), con il motivo scritto nella PR.

## Dubbi

Su scelte di prodotto, testi o priorità chiedi a Davide prima di scrivere codice: costa meno di una PR da rifare.
