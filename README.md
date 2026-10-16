# Trama

> Dal documento al backlog, con le regole. Strumento interno del gruppo. Linee guida del marchio: `/brand` e `BRAND.md`.

Dal documento di requisiti al backlog Jira, passo dopo passo, con Claude e le regole del playbook.

- `/` copertina pubblica
- `/studio` lo strumento (accesso con Atlassian)

## Come è fatto

| Parte | Dove | Cosa fa |
| --- | --- | --- |
| Pagine | `public/index.html`, `public/studio.html` | Copertina e strumento (HTML e JS senza build) |
| Runtime del browser | `public/studio-runtime.js` | Sincronizzazione dati, chiamate a Jira e a Claude |
| Login | `netlify/functions/auth-*.mjs` | OAuth 2.0 (3LO) Atlassian, sessione in cookie `HttpOnly` |
| Dati | `netlify/functions/project*.mjs` | Progetti e documenti su Postgres (Neon), sincronizzati ogni 6 secondi |
| Jira | `netlify/functions/jira.mjs`, `netlify/lib/jira-ops.mjs` | API REST di Jira Cloud con il token dell'utente |
| Claude | `scripts/claude-bridge.mjs` | Ponte locale: usa Claude Code sul tuo Mac con il tuo abbonamento |

Claude non gira sul server: lo studio lo chiama tramite un **ponte locale** (`npm run claude`) che usa Claude Code sul tuo Mac, autenticato con il tuo abbonamento. Il ponte ascolta solo su `127.0.0.1:8790`, accetta richieste solo dal sito in `APP_URL` (e da `http://localhost:8888`) e lancia `claude -p` senza strumenti in una cartella temporanea vuota. Senza ponte acceso, lo studio funziona tutto tranne le funzioni di Claude.

**Chi vede cosa:** ogni progetto appartiene a un sito Atlassian. Chiunque acceda a quel sito con il proprio account vede e modifica il progetto. Su Jira ognuno agisce con i propri permessi.

## Cosa ti serve

1. **Account Netlify** (piano gratuito).
2. **Database Neon** (piano gratuito): https://neon.tech
3. **App OAuth Atlassian**: https://developer.atlassian.com/console/myapps/
4. **Claude Code** installato sul Mac con il tuo account: `npm install -g @anthropic-ai/claude-code`, poi `claude` per accedere.

## 1. App OAuth Atlassian

1. Vai su developer.atlassian.com › Console › *Create* › **OAuth 2.0 integration**.
2. **Permissions**:
   - *Jira API* › Add › Configure: `read:jira-work`, `write:jira-work`, `read:jira-user`.
3. **Authorization** › OAuth 2.0 (3LO) › Callback URL:
   - in produzione `https://<il-tuo-sito>.netlify.app/api/auth/callback`
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

Il sito è su http://localhost:8888.

## 4. Usa Claude

Ogni volta che lavori con lo studio, in un terminale sul Mac:

```bash
cd ~/Desktop/Trama && npm run claude
```

Lascia aperto il terminale: lo studio si collega da solo entro qualche secondo (in alto compare «Claude Code collegato»). Chrome potrebbe chiederti di consentire al sito l'accesso ai dispositivi della rete locale: accetta, è il ponte sul tuo Mac.

## 5. Pubblica su Netlify

Il modo più semplice è collegare un repository Git: Netlify › *Add new project* › *Import an existing project*. In alternativa, dal terminale:

```bash
npx netlify login
```

```bash
npx netlify deploy --prod
```

Poi in Netlify › *Project configuration* › *Environment variables* imposta:

| Variabile | Valore |
| --- | --- |
| `APP_URL` | `https://<il-tuo-sito>.netlify.app` (senza barra finale) |
| `DATABASE_URL` | connection string di Neon |
| `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET` | dall'app OAuth |
| `TOKEN_KEY` | 32 byte in base64 (`npm run key`); non cambiarla dopo il primo accesso, o gli utenti dovranno rientrare |

Rifai il deploy dopo aver impostato le variabili e controlla che la callback dell'app Atlassian usi lo stesso dominio di `APP_URL`.

## Usare lo studio da iPhone (Safari)

Interfaccia, caricamento documenti, kit, backlog, creazione su Jira e registro funzionano da Safari su iPhone e iPad. L'unica parte che dal telefono non funziona da sola è **Claude**: il ponte gira sul Mac, e l'indirizzo `127.0.0.1` sul telefono è il telefono stesso. Serve un indirizzo **https** con cui il Mac sia raggiungibile.

Il modo più semplice e privato è Tailscale (gratuito per uso personale):

1. Installa Tailscale sul Mac e sull'iPhone e accedi con lo stesso account.
2. Scegli un token e salvalo nel `.env` del Mac (`BRIDGE_TOKEN=<stringa lunga casuale>`, per esempio l'output di `npm run key`).
3. Avvia il ponte (`npm run claude`) e, in un altro terminale, esponilo in https dentro la tua rete privata:

```bash
tailscale serve --bg 8790
```

4. Sull'iPhone apri lo studio › passo 1 › **Impostazioni del ponte Claude Code**, incolla l'indirizzo `https://<nome-mac>.<rete>.ts.net` e il token, poi **Salva e ricollega**.

Il token impedisce a chiunque conosca l'indirizzo di usare il tuo abbonamento. Non usare tunnel pubblici (per esempio ngrok o Cloudflare) senza `BRIDGE_TOKEN`.

Mac acceso e ponte avviato sono necessari anche quando usi lo studio dal telefono.

## Limiti noti

- Lo strumento non crea progetti, componenti o versioni in Jira: se un ticket li richiede vanno creati a mano.
- Due persone che modificano **lo stesso** requisito o ticket nello stesso momento: vince l'ultima modifica salvata.
- I documenti caricati vengono salvati come testo, fino a 110.000 caratteri ciascuno. Le immagini vengono trascritte da Claude.
- Claude funziona solo dal Mac su cui gira il ponte e consuma i limiti del tuo piano Claude Code. In modalità ponte la chat risponde e propone, ma non modifica direttamente requisiti e ticket.
- Safari su Mac può bloccare le richieste dal sito al ponte locale su `127.0.0.1`: usa Chrome o Firefox sul Mac. Da iPhone vedi la sezione dedicata sopra.
- `netlify-cli` è fissato alla versione 27.10.2: la 27.12.1 va in crash in locale sulle richieste senza `content-type`.
