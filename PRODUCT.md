# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Utente principale: il **Product Owner** di un progetto del gruppo. Lavora al computer, in sessioni lunghe, per trasformare il documento di requisiti del cliente (Word, PDF, Excel, immagini) in un backlog Jira strutturato, passo dopo passo.

Utenti secondari, che leggono e correggono il risultato: **sviluppo** (ticket chiari, dipendenze esplicite), **QA** (criteri di accettazione e Scheda QA allegata a ogni storia su Jira), **Delivery e PMO** (stessa struttura in tutti i progetti, registro delle decisioni).

## Product Purpose

Trama porta un documento di requisiti a un backlog Jira pronto: Tessa, l'assistente AI, estrae i requisiti, propone ticket, kit di progetto, domande e ipotesi; Trama controlla i metadati obbligatori e scrive su Jira solo dopo la conferma del PO, con i suoi permessi. Strumento interno del gruppo, in italiano e in inglese.

Successo (misure confermate, senza cifre per ora):
- meno giri di correzione e meno revisioni sugli output a fine sprint;
- meno chiarimenti dell'ultimo minuto, perché i dubbi si chiudono prima di creare i ticket e restano nel registro delle decisioni;
- progetti Jira uniformi (stessa struttura, label e prefissi);
- meno tempo dal documento al primo backlog in Jira.

## Positioning

Il punto di forza è la **scomposizione dei requisiti fatta da Tessa**, applicata secondo il playbook del gruppo: ogni scelta fatta al posto del PO è una ipotesi dichiarata e da confermare, e nulla arriva su Jira senza controlli e conferma esplicita. Il PO decide, Tessa propone.

## Operating Context

- Flusso in sei passi, sempre nello stesso ordine: Progetto Jira, Requisiti, Domande di apertura, Kit di progetto, Backlog, Crea su Jira. Il Registro delle decisioni è sempre a portata.
- Struttura Jira del gruppo: Cliente › Project › Fase (= release) › Feature Epic › ticket (Story, UX Story, Task, Bug).
- Accesso con Atlassian (con i permessi del singolo utente); lavoro condiviso tra colleghi dello stesso sito Atlassian.
- Tessa funziona attraverso Claude Code sul computer di ciascuno (un piccolo ponte locale), con il suo abbonamento: senza ponte tutto funziona tranne le proposte di Tessa.
- Dati in Unione Europea (database a Francoforte, funzioni a Francoforte).

## Capabilities and Constraints

- Solo computer: finestra larga almeno 900 pixel. Telefono e tablet non sono supportati.
- Trama non cancella nulla in Jira e non crea progetti, componenti o versioni.
- Lingue: italiano (lingua del codice) e inglese; i dati del progetto (requisiti, ticket, documenti) non si traducono.
- Terminologia da rispettare: «Trama» (mai «studio»), «Tessa» (nella chat mai il nome del modello), «kit» (K1–K9), «registro delle decisioni», «ponte», «Fase = release».
- Ancora da decidere: come collegare Tessa a Claude senza ponte locale (ipotesi allo studio); correzione o esclusione delle segnalazioni del rilevatore di design.

## Brand Commitments

Dal brand book (`BRAND.md`, `public/brand.html`) e da `public/tokens.css`:
- Nome **Trama** (iniziale maiuscola; `trama` minuscolo solo nel logo, dove la t è quella del logotipo Tinexta, da non ridisegnare né usare da sola). Mai «TRAMA», «Trama AI», «Trama App» o il vecchio nome «Backlog Studio».
- Payoff: *Dal documento al backlog, con le regole.*
- Tono: preciso, chiaro, affidabile; frasi brevi, voce attiva, numeri veri, la cosa più importante all'inizio; errori = cosa è successo + cosa fare; niente enfasi, emoji o promesse di «magia».
- Tessa: il nome viene da «tessere»; l'icona è il filo zafferano che esce dal labirinto (filo di Arianna).
- Colori e tipografia sono nei token del progetto (chiaro e scuro); lo zafferano è un accento per le forme, mai per il testo su chiaro.

## Evidence on Hand

- Il progetto di prova «OrtoComune» (`tests/fixtures/progetto-prova.json`, 75 requisiti, 67 ticket) è **interamente inventato**, a scopo dimostrativo.
- Non ci sono testimonianze, clienti, cifre di risparmio o risultati misurati: non vanno inventati.

## Product Principles

1. **Il PO decide, Tessa propone.** Ogni ipotesi è dichiarata e da confermare; nulla si fa «da solo».
2. **Prima si legge, poi si scrive.** Controllo, anteprima e conferma esplicita prima di ogni scrittura su Jira.
3. **Le regole sono visibili.** Il playbook non sta in un documento da ricordare: Trama lo mostra e lo controlla nel punto in cui serve.
4. **Chiarezza per tutto il team.** Ciò che esce da Trama deve essere leggibile da chi sviluppa, collauda e coordina.
5. **Strumento di lavoro, non vetrina.** Sessioni lunghe al computer: densità e precisione prima dell'effetto.

## Accessibility & Inclusion

Standard richiesto: WCAG 2.2 AA, controllato con axe su tutte le pagine e i passi, anche in modalità scura e in inglese. Tastiera completa (Invio, frecce, Esc), focus visibile, nessun comando annidato in un altro, movimento ridotto rispettato.
