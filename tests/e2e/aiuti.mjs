// Aiuti comuni ai test e2e e visivi dello studio (non è un file di test).
import { expect } from "@playwright/test";

export const PROJECT = "/studio?p=progetto-prova";

export async function openStudio(page) {
  await page.goto(PROJECT);
  await expect(page.locator(".progress b")).toContainText("di 6 passi completati");
}
export const goToStep = (page, name) => page.locator("#stepList .st", { hasText: name }).click();
export async function openSec(page, title) {
  const sec = page.locator("#main details.sec", { has: page.locator("summary .sec-t", { hasText: title }) });
  if (!(await sec.evaluate((d) => d.open))) await sec.locator(":scope > summary").click();
  return sec;
}
// Crea su Jira è uno stepper: dal controllo (parte da solo) si va avanti con «Continua» fino alle ipotesi
export async function toAck(page) {
  const ctl = page.locator('#main details.sec[data-sec="create:controllo-prima-della-creazione"]');
  await expect(ctl.locator(".sec-go")).toHaveAttribute("aria-disabled", "false", { timeout: 20_000 });
  await openSec(page, "Controllo prima della creazione");
  await ctl.locator(".sec-go").click();
  await expect(page.locator('#main details.sec[data-sec="create:anteprima"]')).toHaveAttribute("open", "");
  await page.locator('#main details.sec[data-sec="create:anteprima"] .sec-go').click();
  await expect(page.locator("#ackBox")).toBeVisible();
}
export async function runCreate(page) {
  await openSec(page, "Ipotesi e scelte fatte al tuo posto");
  await page.locator("#ackBox").check();
  await page.locator('#main details.sec[data-sec="create:ipotesi-e-scelte-fatte-al-tuo-posto"] .sec-go').click();
  const run = page.locator("[data-act=runCreate]");
  await run.click(); // primo clic: chiede conferma
  await expect(run).toContainText("Conferma");
  await run.click();
}
export const DONE = /Verifica: \d+ di \d+ ticket con tutti i campi salvati/;
// uno studio «appena creato»: senza documenti e senza requisiti
export const emptyReqs = (page) => page.evaluate(() => { for (const c of ["docs", "reqs"]) for (const k of Object.keys(S[c])) del(c, k); });
export const simState = async (request) => (await request.get("/__sim/state")).json();
