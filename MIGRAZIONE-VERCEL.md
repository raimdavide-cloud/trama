# Migrazione di Trama su Vercel

Stato: **completata il 16 ottobre 2026**. Trama è in produzione su https://trama-backlog.vercel.app. Questo documento resta come storia della migrazione: da allora le funzioni sono passate da `netlify/` a `server/` e la configurazione di Netlify è stata tolta (si recupera dalla storia di git).

## Cosa è stato aggiunto

| File | A cosa serve |
|---|---|
| `api/router.mjs` | Un'unica funzione Vercel che instrada `/api/*` verso gli stessi gestori di `netlify/functions`. I percorsi sono letti da `config.path` di ciascuno, quindi le due piattaforme restano allineate. Include anche `/api/cron/privacy-report`, protetto da `CRON_SECRET` |
| `vercel.json` | Pagine senza `.html` (`/studio`, `/privacy`), intestazioni di sicurezza e di cache, funzioni a Francoforte (`fra1`, vicino al database Neon), durata massima 60 s, cron giornaliero alle 03:00 per la segnalazione privacy |
| `.vercelignore` | Non carica `.env` né `node_modules` |

Provato in locale: il router instrada tutti i percorsi, passa correttamente `id`, `col`, `item` e `op`, risponde 401 senza sessione, 404 sui percorsi inesistenti e il cron rifiuta le richieste senza segreto. **Non provato:** il comportamento sulla piattaforma Vercel vera (cookie, redirect, cron). Serve un deploy di anteprima.

## Prima di partire

1. **Piano.** Il team «Trama» è su Hobby (uso personale e non commerciale). Per uno strumento del gruppo serve Pro. Il cron giornaliero funziona anche su Hobby, ma con orario impreciso entro l'ora.
2. **Non farlo prima della demo.** Il passaggio richiede di cambiare l'indirizzo di callback in Atlassian, che ne accetta uno solo: durante il cambio il login su Netlify non funziona.

## Passi

1. **Collegare il progetto** (crea il progetto nel team Trama): `vercel link`, nome `trama-backlog`.
2. **Variabili d'ambiente** (Production e Preview), senza mai stamparle:

   | Variabile | Valore |
   |---|---|
   | `DATABASE_URL` | la stessa di Netlify (il database non si sposta) |
   | `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET` | gli stessi di Netlify |
   | `TOKEN_KEY` | **la stessa di Netlify**: se cambia, i token salvati non si decifrano e tutti devono rifare l'accesso |
   | `APP_URL` | il nuovo indirizzo, senza barra finale |
   | `CRON_SECRET` | nuova stringa casuale di almeno 16 caratteri |
   | `PRIVACY_REPORTER_ACCOUNT_ID` | facoltativa, come su Netlify |

3. **Anteprima:** `vercel deploy` (senza `--prod`). Controllare le pagine statiche e che `/api/me` risponda 401. Il login Atlassian non si prova sull'anteprima, perché la callback registrata è una sola.
4. **Produzione:** `vercel deploy --prod`.
5. **Passaggio (qualche minuto senza login):**
   - nella console Atlassian cambiare la *Callback URL* in `<nuovo indirizzo>/api/auth/callback`;
   - nel file `.env` locale cambiare `APP_URL` e riavviare il ponte (`npm run claude`): l'elenco degli indirizzi permessi si ricava da lì;
   - provare login, un progetto, il caricamento di un documento e la creazione su Jira.
6. **Informativa privacy:** `public/privacy.html` dice che le funzioni girano su Netlify negli Stati Uniti. Dopo il passaggio va aggiornata: Vercel, regione Francoforte, e anche l'indirizzo nelle impostazioni dell'app Atlassian.
7. **Controllo del cron:** dopo il primo giorno, in Vercel › *Settings › Cron Jobs* › *View Logs*.

## Se qualcosa va storto

Netlify resta intatto. Per tornare indietro: rimettere la callback e `APP_URL` di prima e riavviare il ponte. Non serve migrare dati, perché il database Neon è lo stesso.

## Dopo, quando tutto è stabile

Spegnere il sito su Netlify, togliere `netlify.toml` e `netlify-cli`, aggiornare il README (che oggi descrive solo Netlify).
