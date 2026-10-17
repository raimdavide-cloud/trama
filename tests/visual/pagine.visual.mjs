// Confronto visivo pixel per pixel, solo in locale (le immagini di riferimento dipendono da sistema e caratteri del Mac).
// Aggiornare le immagini dopo un cambiamento voluto: npm run test:visual -- --update-snapshots
import { test, expect } from "@playwright/test";

const PROJECT = "/studio?p=progetto-prova";
// tolleranza minima: assorbe le piccole oscillazioni nel disegno dei caratteri, non un cambiamento di impaginazione
const shot = { fullPage: true, animations: "disabled", maxDiffPixelRatio: 0.002 };

test.beforeEach(async ({ request, page }) => {
  await request.get("/__sim/reset");
  await page.clock.setFixedTime(new Date("2026-10-16T10:00:00")); // orari e date sempre uguali
});

for (const path of ["/", "/brand", "/installazione", "/privacy", "/componenti", "/architettura"]) {
  test(`pagina ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`pagina${path === "/" ? "-home" : path.replace(/\//g, "-")}.png`, { ...shot, mask: [page.locator(".player"), page.locator("[data-origin]")] });
  });
}

test("Trama · progetti", async ({ page }) => {
  await page.goto("/studio");
  await expect(page.locator(".proj-card")).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot("studio-progetti.png", shot);
});

const STEPS = ["Progetto Jira", "Requisiti", "Domande di apertura", "Kit di progetto", "Backlog", "Crea su Jira", "Registro decisioni"];
for (const [i, name] of STEPS.entries()) {
  test(`Trama · ${name}`, async ({ page }) => {
    await page.goto(PROJECT);
    await expect(page.locator(".progress b")).toContainText("di 6 passi completati");
    await page.locator("#stepList .st", { hasText: name }).click();
    if (name === "Crea su Jira") await expect(page.locator('#main details.sec[data-sec="create:controllo-prima-della-creazione"] .sec-go')).toHaveAttribute("aria-disabled", "false", { timeout: 20_000 }); // controllo finito
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("#main")).toHaveScreenshot(`studio-${i + 1}.png`, { ...shot });
  });
}

test("Trama · regole, barra in alto e pannello Collegamenti", async ({ page }) => {
  await page.goto(PROJECT);
  await expect(page.locator(".progress b")).toContainText("di 6 passi completati");
  await page.locator("#rulesBtn").click();
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("#main")).toHaveScreenshot("studio-regole.png", shot);
  await page.locator("[data-act=closeRules]").click();
  await page.locator("#capChips button").click();
  await expect(page.locator(".app > header")).toHaveScreenshot("studio-barra.png", shot);
  await expect(page.locator("#bridgePanel")).toHaveScreenshot("studio-collegamenti.png", shot);
});

test("Trama · riepilogo a destra", async ({ page }) => {
  await page.goto(PROJECT);
  await expect(page.locator(".progress b")).toContainText("di 6 passi completati");
  await page.locator("#stepList .st", { hasText: "Kit di progetto" }).click();
  await expect(page.locator("#recap .rc-st")).toContainText("Passo completato"); // riepilogo aggiornato con i dati del passo
  await expect(page.locator("#recap .rc-go")).toHaveClass(/primary/);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("#recap")).toHaveScreenshot("studio-riepilogo.png", shot);
});
