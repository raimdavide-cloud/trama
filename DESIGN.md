---
name: Trama
description: Dal documento di requisiti al backlog Jira, con le regole. Carta calda, inchiostro indaco e un filo zafferano che lega ogni cosa a ciò da cui deriva.
colors:
  paper: "#F6F3EC"
  sheet: "#FDFCF9"
  sunk: "#EDE9DF"
  rule: "#DCD6C8"
  rule-strong: "#8B8571"
  ink: "#1B1A2E"
  slate: "#5B5870"
  indigo: "#3448C5"
  indigo-deep: "#23307A"
  indigo-wash: "#E6E9FA"
  thread: "#B06C08"
  saffron: "#F2A541"
  saffron-wash: "#FCEFD9"
  saffron-text: "#9A5B06"
  sage: "#1F6B4A"
  sage-wash: "#E1F2E9"
  coral: "#B33A24"
  coral-wash: "#FBE6E1"
  night: "#12132A"
  night-sheet: "#1A1C38"
  night-sunk: "#23254A"
  night-rule: "#32356A"
  night-rule-strong: "#7478B0"
  night-ink: "#ECEAF5"
  night-slate: "#A6A9C9"
  night-indigo: "#9AA6FF"
  night-thread: "#F2B04F"
  night-indigo-wash: "#262A5E"
  night-sage: "#5FCB97"
  night-sage-wash: "#133126"
  night-saffron-wash: "#3A2C12"
  night-coral: "#FF8E7A"
  night-coral-wash: "#3B1A16"
  band: "#141B47"
  night-band: "#18205A"
  band-ink: "#F2F3FB"
  band-muted: "#AEB5DD"
typography:
  display:
    fontFamily: "Bricolage Grotesque, Segoe UI, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  hero:
    fontFamily: "Bricolage Grotesque, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(36px, 4.6vw, 58px)"
    fontWeight: 800
    lineHeight: 1.04
    letterSpacing: "-0.035em"
  lede:
    fontFamily: "Figtree, Segoe UI, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.55
  headline:
    fontFamily: "Bricolage Grotesque, Segoe UI, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "Figtree, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Figtree, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  code:
    fontFamily: "JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 500
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
  xxxl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.indigo}"
    textColor: "#FFFFFF"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  button-primary-hover:
    backgroundColor: "{colors.indigo-deep}"
  button-secondary:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  button-disabled:
    backgroundColor: "{colors.sunk}"
    textColor: "{colors.slate}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "7px 12px"
  badge:
    backgroundColor: "{colors.sunk}"
    textColor: "{colors.slate}"
    rounded: "{rounded.pill}"
    height: "22px"
  tooltip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  table-row:
    height: "36px"
---

# Design System: Trama

## Overview

**Creative North Star: "Il filo"**

Trama fa una cosa sola: tiene un filo continuo tra ciò che il cliente ha scritto, ciò che Tessa propone e ciò che finisce su Jira. Il sistema visivo è costruito per mostrare quel filo e per togliere tutto il resto: niente riquadri dentro riquadri, niente decorazione, niente colore che non segnali qualcosa. È uno strumento di lavoro per Product Owner che lo usano per ore: carta calda, inchiostro, righe sottili, gli identificativi (RF-001, T-002, ORTO-1011) come protagonisti tipografici.

Il tono è quello di un registro ben tenuto, non di una vetrina: calmo, preciso, leggibile a lungo. Il colore del marchio (indaco) serve per l'azione principale e la selezione; il zafferano è il filo e basta.

**Key Characteristics:**
- Superfici piatte separate da linee sottili; l'ombra compare solo su ciò che sta sopra la pagina (menu, pannello, chat).
- Un solo accento per schermata: l'azione principale in indaco, oppure il filo.
- Identificativi in monospazio; testo in Figtree; titoli in Bricolage Grotesque.
- Chiaro e scuro definiscono gli stessi ruoli: un componente non sa in che tema si trova.

## Colors

Neutri caldi tinti di indaco, un colore di marchio, un filo, tre stati. Tutto sta in `public/tokens.css` come **ruoli** (`--bg`, `--surface`, `--primary`, `--thread`…); i componenti non usano mai i valori grezzi. `npm run check` rifiuta gli esadecimali fuori da quel file.

### Primary
- **Indaco** (`#3448C5`, `--primary`): azione principale, link, selezione, anello di focus. Nel tema scuro diventa `#9AA6FF`. Il testo sul pulsante è `--on-primary`.
- **Indaco profondo** (`#23307A`, `--primary-strong`): passaggio del mouse sul pulsante principale.

### Secondary
- **Filo** (`#B06C08` chiaro, `#F2B04F` scuro, `--thread`): la linea che lega un ticket al requisito da cui nasce, il nodo dell'avanzamento, ciò che propone Tessa. Mai come colore di testo. Il valore di marchio (`--zafferano-500`, `#F2A541`) resta per il logo e il pulsante di Tessa; il filo è più scuro nel tema chiaro per arrivare a 3:1 sulla carta.
- **Testo zafferano** (`--accent-text`) e **zafferano chiaro** (`--thread-soft`): solo dentro le etichette di avviso.

### Tertiary
- **Salvia** (`--ok`, `--ok-soft`): fatto, verificato.
- **Ambra** (`--warn`, `--warn-soft`): da guardare, non blocca.
- **Corallo** (`--err`, `--err-soft`): blocca, va corretto.

### Neutral
- **Carta** (`#F6F3EC`, `--bg`): sfondo della pagina. Scuro: `#12132A`.
- **Foglio** (`#FDFCF9`, `--surface`): sezioni, menu, pannelli. Scuro: `#1A1C38`.
- **Incassato** (`#EDE9DF`, `--sunk`): zone incassate, passaggio del mouse (`--hover`), controlli spenti. Scuro: `#23254A`.
- **Linea** (`#DCD6C8`, `--line`): separatori e bordi di contenitori. Scuro: `#32356A`.
- **Linea forte** (`#8B8571`, `--line-strong`): bordo di campi, caselle, zone di rilascio (3:1). Scuro: `#7478B0`.
- **Linea media** (`#BDB6A3`, `--line-mid`): il perimetro delle griglie e delle liste nelle pagine pubbliche, tra la linea e quella forte; solo decorativa (non serve 3:1). Scuro: `#474B86`.
- **Inchiostro** (`#1B1A2E`, `--fg`) e **ardesia** (`#5B5870`, `--muted`): testo e testo secondario. Scuro: `#ECEAF5` e `#A6A9C9`.

### Named Rules
**La regola del filo unico.** Il zafferano compare su una cosa per schermata: o il filo di un gruppo, o lo stato di Tessa. Se serve su due cose, una delle due non è il filo.

**La regola dei ruoli.** Un colore grezzo (`--indaco-500`, `--carta`…) non si usa in un componente: si usa il ruolo. È ciò che permette al tema scuro di funzionare senza una riga in più.

**La regola dei contrasti.** `npm run design:contrasto` controlla 30 coppie in ciascun tema: 4,5:1 per il testo, 3:1 per bordi di campi, filo, spie e anello di focus. Una coppia nuova si aggiunge allo script, non si giudica a occhio.

## Typography

**Display Font:** Bricolage Grotesque (poi Segoe UI, system-ui)
**Body Font:** Figtree (poi Segoe UI, system-ui)
**Label/Mono Font:** JetBrains Mono, solo per codici, chiavi e valori

**Character:** un titolo con carattere e un testo neutro da lavoro. Il monospazio non è un costume tecnico: serve a leggere gli identificativi e i numeri in colonna.

### Hierarchy
- **Titolo di pagina** (800, `--fs-2xl` 28 px, 1.15): un titolo per passo. Il titolo grande della homepage usa `--fs-3xl` 36 px o più.
- **Titolo della homepage** (800, 36–58 px fluido, 1.04): una sola volta per pagina, nel blocco iniziale. I titoli di sezione della homepage vanno da 28 a 36 px.
- **Introduzione** (400, `--fs-lede` 18 px): il paragrafo che accompagna un titolo nelle pagine pubbliche.
- **Titolo di sezione** (700, `--fs-xl` 20 px): sezioni apribili e riepilogo.
- **Testo corrente** (400, `--fs-base` 15 px, 1.5): descrizioni, righe lunghe; misura massima 72ch.
- **Controlli e tabelle** (600/400, `--fs-m` 14 px e `--fs-s` 13 px): pulsanti, campi, celle.
- **Etichetta** (600, `--fs-xs` 12 px): intestazioni di colonna, etichette di stato, note.
- **Codice** (500, 12 px, monospazio): RF-001, T-002, ORTO-1011, descrizioni dei ticket.

### Named Rules
**La regola della scala.** Le dimensioni sono solo `--fs-xs … --fs-3xl` (12, 13, 14, 15, 16, 20, 28, 36 px). Una misura nuova è un errore di progetto, non una scelta.

**La regola dell'etichetta.** Niente piccole etichette in maiuscolo sopra i titoli: il titolo regge da solo. La riga «Passo 5 di 6 · Creazione» è testo discreto, non un'insegna.

## Layout

Tre colonne sopra i 1300 px: passi (232 px) · lavoro · riepilogo (264 px); sotto, il riepilogo sparisce. Sotto i 900 px Trama mostra un avviso: si usa solo su desktop. Il lavoro inizia entro i 330–430 px dall'alto, non oltre.

Gli spazi sono multipli di 4 (`--sp-1 … --sp-7`, da 4 a 48 px): dentro un gruppo 4–8, tra gruppi 16–24, tra sezioni 32–48. Le righe di tabella sono alte 36 px (`--row-h`); pulsanti e campi risultano alti 34 px dal loro riempimento (8/12 px), le etichette 22 px.

Il contenuto è raggruppato con spazio e linee, non con contenitori: una sezione ha un bordo, ma dentro non ne ha un secondo.

## Elevation & Depth

Piatto a riposo. La profondità è tonale (carta → foglio → incassato) e l'ombra compare solo su ciò che sta sopra la pagina.

### Shadow Vocabulary
- **Scheda** (`--shadow`): rara; riepilogo e pannelli appoggiati.
- **Menu e barre** (`--shadow-pop`): menu a tendina, barra delle selezioni.
- **Chat** (`--shadow-float`): finestra di Tessa.
- **Pannello laterale** (`--shadow-side`): dettaglio di requisito e ticket.
- **Pulsante della chat** (`--shadow-fab`, `--shadow-fab-hover`).

Nel tema scuro le stesse ombre sono nere, più forti: su fondo scuro l'ombra indaco non si vedrebbe.

### Named Rules
**La regola del piano.** Se un elemento non galleggia sopra qualcos'altro, non ha ombra.

## Shapes

Raggi piccoli e costanti: 4 px per campi e pulsanti (`--r-s`), 8 px per menu e pannelli (`--r-m`), 12 px per le sezioni (`--r-l`). La pillola (`--r-pill`) è riservata alle etichette di stato; il cerchio ai nodi e agli avatar. Bordi da 1 px (`--bw`); il filo è 2 px (`--thread-w`).

Il filo ha tre forme: **tratteggiato** = proposta di Tessa (bozza), **pieno** = creato su Jira, **puntinato rosso** = errore. Compare solo dove c'è una derivazione da mostrare (oggi: i ticket sotto il loro requisito, l'avanzamento).

## Components

### Buttons
- **Forma:** 4 px, 34 px di altezza (13 px, 600).
- **Primario:** indaco pieno, testo `--on-primary`; **uno solo per schermata**: «Continua» dentro il passo finché non è completo, poi «Prossimo» nel riepilogo. Hover `--primary-strong`. Dove il riepilogo c'è (da 1300 px) il «Avanti» in fondo non si ripete. Nella chat è pieno solo «Applica» dell'ultima proposta aperta; senza proposte, «Invia».
- **Secondario:** foglio con bordo `--line`; hover: bordo indaco.
- **Di testo (`link`):** senza bordo, indaco.
- **Pericoloso:** testo corallo; dopo il primo clic («Conferma: …») diventa corallo pieno.
- **Disattivato:** fondo `--disabled-bg`, testo `--disabled-fg`, bordo `--line`, cursore non consentito. Non usa l'opacità: il testo resta leggibile (≥ 4,5:1).
- **Focus:** anello 2 px `--ring`, distanza 2 px.

### Chips / etichette di stato
- **Stile:** pillola da 22 px, 12 px 600; sfondo `*-soft`, testo del ruolo (`ok`, `warn`, `err`, `acc`).
- **Regola:** il colore dice cosa succede, il testo dice cosa. «Senza release» è sempre un avviso, in ogni punto della pagina.

### Inputs / Fields
- **Stile:** 4 px, bordo `--line-strong` (3:1), fondo `--bg`, testo 14 px; etichetta sopra, 12 px 600 in `--muted`.
- **Hover:** bordo `--muted`. **Focus:** bordo e anello `--ring`.
- **Errore** (`aria-invalid="true"`): bordo `--err`, messaggio sotto con icona. **Disattivato:** come i pulsanti.
- **Segnaposto:** `--muted`.

### Scelte per ticket (`.as`)
- Le scelte fatte al posto della persona si leggono per ticket: prima il progetto e la struttura, poi un'intestazione per ticket (rif., chiave Jira se c'è, titolo) con le sue ipotesi sotto, legate dal filo (tratteggiato = bozza, pieno = creato).
- Prima della creazione sono tutte visibili (vanno lette per essere confermate); nel riepilogo dopo la creazione i primi 8 ticket stanno aperti e gli altri in una riga da aprire. Le chiavi dei ticket creati stanno in una riga a parte, non in un paragrafo.
- Una proposta di Tessa nella chat ha un nodo tratteggiato al posto della scintilla: il filo è ciò che Tessa propone.

### Pagine pubbliche (homepage)
- Il filo organizza le sequenze: i sei passi sono un filo continuo con un nodo numerato per passo; i cinque momenti della demo sono un filo con il nodo pieno su quello che si guarda; i ticket proposti nelle demo e negli esempi hanno il filo tratteggiato.
- Ogni sezione ha un perimetro leggibile: le sezioni si alternano tra fondo (`--bg`) e foglio (`--surface`) con una linea sopra e sotto; vantaggi, regole, garanzie e dati chiave sono griglie con le linee condivise (`--line-mid`), senza spazio tra le celle e senza raggio, non schede staccate; i sei passi e i cinque momenti sono liste con una linea sopra e sotto e una sottile tra una voce e l'altra. Le uniche superfici piene sono la demo (il prodotto), le due colonne degli esempi e la fascia scura finale.
- Niente icone decorative: restano solo dove indicano un'azione (menu, riproduci) o uno stato (spunte).
- Niente finta finestra con i tre pallini: la demo ha una barra con il titolo e l'etichetta «demo».
- Le etichette sopra i titoli sono testo discreto (14 px, `--muted`), non maiuscolo monospazio; il filtro per ruolo usa il tono indaco chiaro, le schede degli esempi sono linguette con una linea sotto.

### Tooltip (`data-tip`)
- Fondo `--tip-bg` (inchiostro), testo `--tip-fg` (carta), 12 px, 4 px di raggio, massimo 260 px.
- Appare con il mouse e con il focus da tastiera; il testo sta anche nella pagina (`sr-only`), quindi lo leggono i lettori di schermo. Serve a spiegare perché un comando è spento.

### Tables / liste gerarchiche
- Intestazioni in Figtree 12 px 600 `--muted`, righe da 36 px, linee sottili, nessuna cornice interna; hover `--hover`, selezione `--selected`.
- **Il filo:** i ticket stanno sotto il loro requisito, legati da una linea che parte dall'intestazione del gruppo (tratteggiata, piena o rossa secondo lo stato, `data-st` sulla riga).
- Il titolo ha la colonna più larga; la colonna Tipo è fissa e non si tronca.

### Detail panels
- Pannello laterale da 580 px (`min(580px,46vw)`), `--shadow-side`; il pulsante di Tessa gli lascia spazio in fondo e resta sopra.
- Sezioni separate da una linea, titoli a 14 px; i campi stanno su due colonne.

### Stati di sistema
- **Caricamento:** un nodo e un filo che avanza (`.prog`): pieno se si conosce il totale, tratteggiato che respira se non lo si conosce; sotto, gli elementi trovati man mano. Nessuna barra che corre, nessuna scintilla.
- **Errore:** riquadro `err` con icona e `role="alert"`; dice cosa è successo e cosa fare.
- **Successo:** riquadro `ok` con icona; una frase.
- **Avviso e informazione:** riquadri `warn` e `info`.
- **Vuoto:** una frase che dice cosa manca e come proseguire (es. «Carica il documento di requisiti per iniziare»); azione alternativa sotto.
- **Focus, hover, selezione, disattivato:** `--ring`, `--hover`, `--selected`, `--disabled-*`: gli stessi ruoli in chiaro e scuro.

## Do's and Don'ts

### Do:
- **Do** usare solo i ruoli di `tokens.css`; aggiungere un ruolo prima di usare un colore.
- **Do** tenere il filo per ciò che deriva da qualcos'altro; tratteggiato se è una proposta, pieno se è confermato.
- **Do** dare a ogni controllo disattivato un motivo leggibile (suggerimento o frase vicina).
- **Do** verificare ogni coppia nuova con `npm run design:contrasto` in entrambi i temi.
- **Do** tenere un solo pulsante principale per schermata.

### Don't:
- **Don't** scrivere colori, dimensioni di carattere o raggi a mano nei componenti.
- **Don't** mettere un contenitore con bordo dentro un altro: raggruppa con spazio e linee.
- **Don't** usare bordi colorati su un solo lato, gradienti di testo, vetro sfocato o ombre a colore fisso.
- **Don't** usare il zafferano come colore di testo né su più cose nella stessa schermata.
- **Don't** segnalare uno stato solo con il colore: sempre testo o icona.
- **Don't** ripetere nel titolo l'icona che sta già nella barra dei passi.
