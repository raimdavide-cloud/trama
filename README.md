# Trama

> Dal documento al backlog, con le regole. Strumento interno del gruppo. Linee guida del marchio: `/brand` e `BRAND.md`.

Dal documento di requisiti al backlog Jira, passo dopo passo, con Claude e le regole del playbook.

- `/` copertina pubblica
- `/studio` lo strumento (accesso con Atlassian)

## Come è fatto

| Parte | Dove | Cosa fa |
| --- | --- | --- |
| Pagine | `public/index.html`, `public/studio.html` + `public/studio-app.js` | Copertina e strumento (HTML e JS senza build, nessuno script inline) |
| Runtime del browser | `public/studio-runtime.js` | Sincronizzazione dati, chiamate a Jira e a Claude |
| API | `api/router.mjs` | Un'unica funzione Vercel che instrada `/api/*` verso i gestori in `server/functions` |
| Login | `server/functions/auth-*.mjs` | OAuth 2.0 (3LO) Atlassian, sessione in cookie `HttpOnly` |
| Dati | `server/functions/project*.mjs`, `server/lib/lazy.mjs` | Progetti e documenti su Postgres (Neon), sincronizzati ogni 6 secondi; all'apertura il testo dei documenti, il log e il controllo di qualità arrivano come segnaposto e si caricano quando servono |
| Jira | `server/functions/jira.mjs`, `server/lib/jira-ops.mjs` | API REST di Jira Cloud con il token dell'utente |
| Claude | `scripts/claude-bridge.mjs` | Ponte locale: usa Claude Code sul tuo Mac con il tuo abbonamento |
| Sicurezza | `vercel.json`, `server/functions/csp-report.mjs` | Intestazioni e Content-Security-Policy (per ora in sola segnalazione, violazioni nei log) |
| Test | `tests/` | Simulatore di Jira, dati di prova anonimizzati, test unitari ed end-to-end |

Claude non gira sul server: Trama lo chiama tramite un **ponte locale** (`npm run claude`) che usa Claude Code sul tuo Mac, autenticato con il tuo abbonamento. Il ponte ascolta solo su `127.0.0.1:8790`, accetta richieste solo dal sito in `APP_URL` (e da `http://localhost:8888`) e lancia `claude -p` senza strumenti in una cartella temporanea vuota. Il ponte non passa a `claude` le variabili `ANTHROPIC_API_KEY` e `ANTHROPIC_AUTH_TOKEN`: usa sempre l'abbonamento Claude Code, e se le trova impostate lo segnala con un avviso all'avvio. Senza ponte acceso, Trama funziona tutto tranne le funzioni di Claude.

**Lavoro in più persone:** kit, progetto, chat e ticket si salvano con la versione letta; se un collega ha salvato prima, la modifica si riapplica sulla sua versione. Su Jira lavora una scheda alla volta: chi crea, crea la struttura o aggiorna Jira prende un lock condiviso (scade da solo dopo 2 minuti se la scheda si chiude), e nelle altre schede i pulsanti mostrano chi sta lavorando. Se il server dei dati non risponde, i salvataggi restano in coda e si ritentano da soli, con l'indicatore «N salvataggi in attesa».

**Chi vede cosa:** ogni progetto appartiene a un sito Atlassian. Chiunque acceda a quel sito con il proprio account vede e modifica il progetto. Su Jira ognuno agisce con i propri permessi.

## Cosa ti serve

1. **Account Vercel** (per l'uso del gruppo serve il piano Pro) e la [CLI](https://vercel.com/docs/cli): `npm i -g vercel`.
2. **Database Neon** (piano gratuito): https://neon.tech
3. **App OAuth Atlassian**: https://developer.atlassian.com/console/myapps/
4. **Claude Code** installato sul Mac con il tuo account: `npm install -g @anthropic-ai/claude-code`, poi `claude` per accedere.

## 1. App OAuth Atlassian

1. Vai su developer.atlassian.com › Console › *Create* › **OAuth 2.0 integration**.
2. **Permissions**:
   - *Jira API* › Add › Configure: `read:jira-work`, `write:jira-work`, `read:jira-user`.
3. **Authorization** › OAuth 2.0 (3LO) › Callback URL:
   - in produzione `https://trama-backlog.vercel.app/api/auth/callback`
   - per provare in locale `http://localhost:8888/api/auth/callback`
4. **Distribution**: imposta *Sharing* per permettere l'accesso ai colleghi. Finché l'app non è condivisa può accedere solo il suo proprietario.
5. **Settings**: copia *Client ID* e *Secret*.

## 2. Database

1. Crea un progetto su Neon e copia la *connection string*.
2. Crea le tabelle (una volta sola):

```bash
npm run db:setup
```

## 3. Prova in locale

```bash
npm install
cp .env.example .env
npm run key
```

Incolla l'output di `npm run key` in `TOKEN_KEY`, poi compila le altre variabili in `.env` e avvia il sito:

```bash
npm run dev
```

Il sito è su http://localhost:8888 (`vercel dev`, la prima volta chiede di collegare la cartella al progetto Vercel).

## 4. Usa Claude

Ogni volta che lavori con Trama, in un terminale sul Mac:

```bash
cd ~/Desktop/Trama && npm run claude
```

Lascia aperto il terminale: Trama si collega da solo entro qualche secondo (in alto compare «Claude Code collegato»). Chrome potrebbe chiederti di consentire al sito l'accesso ai dispositivi della rete locale: accetta, è il ponte sul tuo Mac.

## 5. Controlli e test

Come si lavora sul repository (rami, PR, test da far passare, regole del progetto): [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
npm run check
```

Sintassi di tutto il JavaScript (anche dentro le pagine), JSON di configurazione, ponte scaricabile allineato al sorgente, nessun segreto nei file versionati.

```bash
npm test
```

Test end-to-end di Trama con Playwright contro un **simulatore** (`tests/sim/server.mjs`): API in memoria e Jira finto che rispetta i livelli Project › Fase › Epica › ticket. Non serve né il database né un account Atlassian. In locale i test usano Chrome già installato.

- **Unitari** (`tests/unit`): router (`router`); sessioni, cookie, stessa origine e cifratura dei token (`core`); API dei dati con un database finto, compresa la scrittura condizionale (`api`); operazioni Jira contro il Jira finto: campi ammessi, chiavi e label non valide, errori temporanei, nuovo accesso (`jira-ops`); report privacy di Atlassian (`privacy`); scheda QA allegata alle storie (`qa-scheda`); segnalazioni CSP (`csp-report`); versioni dei file statici (`versioni`).
- **End-to-end** (`tests/e2e`):
  - percorso principale (`studio.spec.mjs`);
  - flussi a mano, Domande, Kit, Backlog, esportazioni (anche celle che sembrano formule), resilienza della creazione su Jira con errori simulati, chat, presenza e collegamenti delle pagine (`flussi.spec.mjs`);
  - più schede sullo stesso progetto (conflitti e riapplicazione delle modifiche), lock di Jira tra schede, creazione interrotta, «Non trovati in Jira», label con spazi, «Rigenera» senza ponte e salvataggi ritentati quando il server dei dati non risponde (`robustezza.spec.mjs`);
  - modifiche portate in Jira dopo la creazione (`aggiorna-jira.spec.mjs`), nuova versione del documento (`versione-documento.spec.mjs`), apertura leggera (`apertura.spec.mjs`), presenza dei colleghi (`presenza.spec.mjs`), ricerca e modifica in blocco (`produttivita.spec.mjs`), lingua inglese (`lingua.spec.mjs`);
  - accessibilità WCAG 2.2 AA con axe anche in modalità scura (`accessibilita.spec.mjs`), Content-Security-Policy (`sicurezza.spec.mjs`), icone allineate (`allineamento.spec.mjs`), homepage (`homepage.spec.mjs`).

  Gli aiuti comuni stanno in `aiuti.mjs`.
- **Visivi**, solo in locale (`npm run test:visual`): pagine, passi di Trama e stati come pannelli, progetto nuovo, esito della creazione, finestra media, modalità scura, menu e chat. Le immagini di riferimento stanno in `tests/visual/riferimenti`; dopo un cambiamento voluto: `npm run test:visual -- --update-snapshots`, poi guardale prima del commit.

Il simulatore accetta guasti su richiesta (`POST /__sim/fault`), per provare cosa succede quando Jira risponde con un errore o perde la risposta.

## Lingua dell'interfaccia

Trama è in italiano e in inglese: lo switch con la bandiera sta nell'header e la scelta resta salvata nel browser. I testi restano scritti in italiano nel codice; in inglese `public/i18n.js` li sostituisce con il dizionario `public/i18n-en.js` (testo esatto, oppure modelli con `{n}` numeri, `{q}` nomi tra «», `{k}` chiavi, `{*}` testo libero). I dati del progetto non si traducono; la chat risponde nella lingua scelta.

Dopo aver aggiunto o cambiato testi dell'interfaccia:

```bash
npm run i18n:mancanti
```

elenca i testi senza traduzione (attraversa tutti gli stati di Trama sul simulatore); il test `tests/e2e/lingua.spec.mjs` fallisce finché ne manca uno.

```bash
npm run perf
```

Misure di prestazione di Trama sul simulatore (avvia da solo un simulatore sulla porta 8896): ridisegno dei passi con 67, 134 e 268 ticket, una modifica nel Backlog a CPU normale e rallentata, richieste dei salvataggi in blocco. Con `-- --idle` aggiunge 3 minuti da fermo per la sincronizzazione. Da rifare prima e dopo ogni intervento che tocca liste, controlli o salvataggi.

Per guardare il simulatore nel browser: `npm run sim`, poi http://127.0.0.1:8899/studio?p=progetto-prova.

I dati di prova (`tests/fixtures/progetto-prova.json`) vengono da «Test Prova» con le identità sostituite da valori finti. Per rigenerarli: `npm run fixture`, poi controlla il riepilogo prima del commit.

## 6. Pubblica

La pubblicazione parte da GitHub Actions (`.github/workflows/ci.yml`), non dal computer di chi sviluppa:

- a ogni modifica e a ogni pull request girano controlli e test;
- su una pull request, se i test passano, viene pubblicata un'**anteprima** su Vercel;
- su `main`, se i test passano, viene pubblicata la **produzione** e poi si controlla che le pagine rispondano.

Vercel non pubblica da solo: in `vercel.json` le pubblicazioni automatiche da Git sono spente, così nulla arriva in produzione senza test superati.

Per attivarla, in GitHub › *Settings* › *Secrets and variables* › *Actions*:

| Tipo | Nome | Valore |
| --- | --- | --- |
| Segreto | `VERCEL_TOKEN` | token creato in Vercel › *Account Settings* › *Tokens* |
| Segreto | `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | da `.vercel/project.json` dopo `vercel link` |
| Variabile | `DEPLOY_ENABLED` | `true` |

Le variabili dell'app stanno in Vercel › *Settings* › *Environment Variables*:

| Variabile | Valore |
| --- | --- |
| `APP_URL` | `https://trama-backlog.vercel.app` (senza barra finale) |
| `DATABASE_URL` | connection string di Neon |
| `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET` | dall'app OAuth |
| `TOKEN_KEY` | 32 byte in base64 (`npm run key`); non cambiarla dopo il primo accesso, o gli utenti dovranno rientrare |
| `CRON_SECRET` | stringa casuale di almeno 16 caratteri, per la segnalazione privacy giornaliera |

Per tornare a una versione precedente: Vercel › *Deployments* › la versione buona › *Promote to Production* (oppure `vercel rollback`).

Prima di ogni rilascio che tocca il ponte esegui `npm run bridge:pack`: il controllo blocca la pubblicazione se il ponte scaricabile non è aggiornato.

## Solo da computer

Trama è pensato per il computer: richiede una finestra larga almeno 900 pixel e sotto quella misura mostra un avviso. Telefono e tablet non sono supportati e non vengono provati.

## Limiti noti

- Lo strumento non crea progetti, componenti o versioni in Jira: se un ticket li richiede vanno creati a mano.
- Kit, progetto, chat e ticket sono sotto controllo: se un collega ha salvato prima, la modifica si riapplica sulla sua versione; se non si può (l'elemento non c'è più, o cambia di continuo) Trama lo dice e mostra la sua versione. Requisiti, documenti, domande e decisioni no: due persone che modificano **lo stesso** requisito nello stesso momento, vince l'ultima modifica salvata. Una scheda aperta prima dell'aggiornamento di Trama scrive senza controllo finché non si ricarica.
- Se il server dei dati non risponde, i salvataggi restano in coda e si ritentano da soli (in alto, «N salvataggi in attesa») per 10 minuti al massimo: chiudendo la scheda in quel momento si perdono, e il browser lo avvisa.
- «Sincronizza e verifica» elenca ciò che Jira non restituisce più («Non trovati in Jira»): Jira risponde allo stesso modo per un ticket eliminato e per uno che i tuoi permessi non mostrano, quindi Trama non lo riporta in bozza da sola. Lo fa «Riporta in bozza», dopo la conferma.
- Se una creazione su Jira si interrompe (esito incerto, «Ferma», lock perso), Trama si ferma lì e non crea collegamenti né riepilogo: ricontrolla in Jira prima di riprendere.
- I documenti caricati vengono salvati come testo, fino a 110.000 caratteri ciascuno. Le immagini vengono trascritte da Claude.
- Claude funziona solo dal Mac su cui gira il ponte e consuma i limiti del tuo piano Claude Code. In modalità ponte la chat risponde e propone, ma non modifica direttamente requisiti e ticket.
- Safari su Mac può bloccare le richieste dal sito al ponte locale su `127.0.0.1`: usa Chrome o Firefox.
