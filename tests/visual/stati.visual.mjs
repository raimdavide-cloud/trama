// Confronto visivo degli stati che non si vedono aprendo i passi: pannelli, studio nuovo, dopo la creazione,
// finestra media, modalità scura, menu e chat. Solo in locale, come pagine.visual.mjs.
import { test, expect } from "@playwright/test";
import { PROJECT, openStudio, goToStep, openSec, toAck, runCreate, DONE, emptyReqs } from "../e2e/aiuti.mjs";

const shot = { animations: "disabled", maxDiffPixelRatio: 0.002 };
const ready = (page) => page.evaluate(() => document.fonts.ready);

test.beforeEach(async ({ request, page }) => {
  await request.get("/__sim/reset");
  await page.clock.setFixedTime(new Date("2026-10-16T10:00:00"));
});

test("pannello di un requisito", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Requisiti");
  await page.locator('#main tr[data-k^="req-"]').first().click();
  await expect(page.locator(".sp")).toBeVisible();
  await ready(page);
  await expect(page).toHaveScreenshot("stato-pannello-requisito.png", shot);
});

test("pannello di un ticket", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Backlog");
  await page.locator('#main tr[data-k^="t-"]').first().click();
  await expect(page.locator(".sp")).toBeVisible();
  await ready(page);
  await expect(page).toHaveScreenshot("stato-pannello-ticket.png", shot);
});

test("assegnazione rapida della release", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Requisiti");
  await page.locator("[data-act=relQuick]").click();
  await page.keyboard.press("1");
  await ready(page);
  await expect(page).toHaveScreenshot("stato-release-rapida.png", shot);
});

test("studio nuovo: Requisiti senza documenti, step bloccati", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Requisiti");
  await emptyReqs(page);
  await expect(page.locator("#main details.sec.locked")).toHaveCount(2);
  await ready(page);
  await expect(page.locator("#main")).toHaveScreenshot("stato-studio-nuovo.png", { ...shot, fullPage: true });
});

test("Crea su Jira dopo la creazione: esito", async ({ page }) => {
  test.setTimeout(180_000);
  await openStudio(page);
  await goToStep(page, "Crea su Jira");
  await toAck(page);
  await runCreate(page);
  await expect(page.locator("#main")).toContainText(DONE, { timeout: 150_000 });
  await openSec(page, "Esito della creazione");
  await ready(page);
  const esito = page.locator('#main details.sec[data-sec="create:esito-della-creazione"]');
  await expect(esito).toHaveScreenshot("stato-esito-creazione.png", shot); // chiavi e testi fissi: il simulatore riparte da COM-1001
});

test("finestra media (1100 px): niente riepilogo a destra, tabella leggibile", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await openStudio(page);
  await goToStep(page, "Requisiti");
  await expect(page.locator("#recap")).toBeHidden();
  await ready(page);
  await expect(page).toHaveScreenshot("stato-finestra-media.png", shot);
});

for (const [name, path] of [["home", "/"], ["studio-requisiti", PROJECT]]) {
  test(`modalità scura: ${name}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(path);
    if (path === PROJECT) {
      await expect(page.locator(".progress b")).toContainText("di 6 passi completati");
      await goToStep(page, "Requisiti");
    }
    await ready(page);
    await expect(page).toHaveScreenshot(`stato-scuro-${name}.png`, { ...shot, mask: [page.locator(".player"), page.locator("[data-origin]")] });
  });
}

test("menu del progetto e dell'account, chat aperta", async ({ page }) => {
  await openStudio(page);
  await page.locator("#projBtn").click();
  await ready(page);
  await expect(page).toHaveScreenshot("stato-menu-progetto.png", { ...shot, clip: { x: 0, y: 0, width: 720, height: 420 } });
  await page.keyboard.press("Escape");
  await page.locator("#userBtn").click();
  await expect(page).toHaveScreenshot("stato-menu-account.png", { ...shot, clip: { x: 1040, y: 0, width: 400, height: 420 } });
  await page.keyboard.press("Escape");
  await page.locator("#chatFab").click();
  await expect(page.locator("#chat")).toHaveClass(/open/);
  await expect(page.locator("#chat")).toHaveScreenshot("stato-chat.png", shot);
});
