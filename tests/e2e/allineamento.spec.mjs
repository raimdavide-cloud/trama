// Icone allineate al testo accanto, in tutte le pagine e negli stati principali di Trama.
// La regola sta in allineamento.mjs: centro sulla prima riga o sul blocco di testo (riquadri della home: in alto).
import { test, expect } from "@playwright/test";
import { misalignedIcons } from "./allineamento.mjs";
import { openStudio, goToStep, emptyReqs } from "./aiuti.mjs";

// si misura a riposo: font caricati e transizioni finite (la chat si apre con una transizione di 0,22 s;
// su una macchina lenta, come quella della CI, la misura poteva cadere a metà)
const settled = (page) => page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {})));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await document.fonts.ready;
});
const check = async (page, label) => {
  await settled(page);
  expect.soft(await page.evaluate(`(${misalignedIcons.toString()})()`), label).toEqual([]);
};

test.beforeEach(async ({ request }) => {
  await request.get("/__sim/reset");
});

test("icone allineate: pagine pubbliche", async ({ page }) => {
  for (const path of ["/", "/brand", "/installazione", "/privacy", "/componenti", "/architettura", "/studio"]) {
    await page.goto(path);
    if (path === "/studio") await expect(page.locator(".proj-card")).toHaveCount(1);
    await check(page, path);
  }
});

test("icone allineate: passi, pannelli, menu e chat di Trama", async ({ page }) => {
  test.setTimeout(120_000);
  await openStudio(page);
  for (const name of ["Progetto Jira", "Requisiti", "Domande di apertura", "Kit di progetto", "Backlog", "Crea su Jira", "Registro decisioni"]) {
    await goToStep(page, name);
    if (name === "Crea su Jira") await expect(page.locator('#main details.sec[data-sec="create:controllo-prima-della-creazione"] .sec-go')).toHaveAttribute("aria-disabled", "false", { timeout: 20_000 });
    if (await page.locator("[data-act=secAll]").count()) await page.locator("[data-act=secAll]").click();
    await check(page, name);
  }
  await goToStep(page, "Backlog");
  await page.locator('#main tr[data-k^="t-"]').first().click();
  await check(page, "pannello di un ticket");
  await page.keyboard.press("Escape");
  await goToStep(page, "Requisiti");
  await page.locator("[data-act=relQuick]").click();
  await check(page, "assegnazione rapida");
  await page.keyboard.press("Escape");
  await emptyReqs(page);
  await expect(page.locator("#main details.sec.locked")).toHaveCount(2);
  await check(page, "progetto nuovo con step bloccati");
  await page.locator("#rulesBtn").click();
  await check(page, "Regole del playbook");
  await page.locator("[data-act=closeRules]").click();
  await page.locator("#projBtn").click();
  await check(page, "menu del progetto");
  await page.keyboard.press("Escape");
  await page.locator("#chatFab").click();
  await expect(page.locator("#chat")).toHaveClass(/open/);
  await check(page, "chat aperta");
  // l'intestazione della chat sta dentro la finestra
  const fits = await page.evaluate(() => { const c = document.querySelector("#chat").getBoundingClientRect(); return [...document.querySelectorAll(".chat-h > *:not([hidden])")].every((e) => e.getBoundingClientRect().right <= c.right + 0.5); });
  expect(fits, "«Memoria» e «Riduci» dentro la finestra della chat").toBe(true);
});
