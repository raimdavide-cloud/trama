// Funzione pianificata: ogni giorno segnala ad Atlassian gli account il cui ciclo (7 giorni o quello indicato
// da Atlassian) è scaduto, e cancella o aggiorna i dati personali secondo la risposta.
import { runPrivacyReport } from "../lib/privacy.mjs";

export default async () => {
  try {
    const r = await runPrivacyReport();
    console.log(`privacy report: ${JSON.stringify(r)}`);
  } catch (e) {
    console.log(`privacy report failed: ${String(e.message || e).slice(0, 300)}`);
  }
};

export const config = { schedule: "@daily" };
