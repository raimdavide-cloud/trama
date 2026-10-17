// Lingua dell'interfaccia: switch nell'header, memoria della scelta, copertura dell'inglese. I dati non si traducono.
import { test, expect } from "@playwright/test";
import { openStudio, goToStep, PROJECT, emptyReqs } from "./aiuti.mjs";
import { datiDiProva, isData } from "../../scripts/i18n/filtro.mjs";

test.beforeEach(async ({ request }) => {
  await request.get("/__sim/reset");
});

test("switch della lingua: inglese con bandiera, scelta ricordata, ritorno all'italiano; i dati restano come sono", async ({ page }) => {
  await openStudio(page);
  const btn = page.locator("#langBtn");
  await expect(btn).toContainText("ITA");
  await btn.click();
  await expect(page.locator("#langMenu")).toBeVisible();
  await expect(page.locator('[data-lang="it"]')).toHaveAttribute("aria-checked", "true");
  await page.locator('[data-lang="en"]').click();
  await expect(page.locator(".progress b")).toHaveText(/\d of 6 steps completed/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(btn).toContainText("ENG");
  await expect(page.locator('[data-lang="en"]')).toHaveAttribute("aria-checked", "true");
  await goToStep(page, "Requirements");
  await expect(page.locator("#main h1")).toHaveText("Upload documents and extract requirements");
  await expect(page.locator("#rqSearch")).toHaveAttribute("placeholder", "Search by ID or title");
  // i dati del progetto restano nella loro lingua
  const title = await page.evaluate(() => reqList()[0].title);
  await expect(page.locator('#main tr[data-k^="req-"]').first()).toContainText(title);
  // date e numeri nel formato inglese, chat nella lingua dell'interfaccia
  expect(await page.evaluate(() => LOCALE())).toBe("en-GB");
  await page.reload(); // la scelta resta
  await expect(page.locator(".progress b")).toHaveText(/steps completed/);
  await page.locator("#langBtn").click();
  await page.locator('[data-lang="it"]').click();
  await expect(page.locator(".progress b")).toHaveText(/\d di 6 passi completati/);
  await expect(page.locator("html")).toHaveAttribute("lang", "it");
});

test("inglese: nessun testo dell'interfaccia resta in italiano, in tutti i passi, pannelli, menu e chat", async ({ page, context }) => {
  test.setTimeout(120_000);
  await context.addInitScript(() => { try { localStorage.setItem("trama:lang", "en"); } catch {} });
  await page.goto("/studio");
  await expect(page.locator(".proj-card")).toHaveCount(1);
  await page.goto(PROJECT);
  await expect(page.locator(".progress b")).toHaveText(/steps completed/);
  for (const id of ["jira", "reqs", "questions", "kit", "backlog", "create", "decisions"]) {
    await page.evaluate((id) => A.go({ dataset: { i: STEPS.findIndex((x) => x.id === id) } }), id);
    if (id === "create") await page.waitForFunction(() => !!T.pre, null, { timeout: 20_000 });
    const n = await page.locator("#main details.sec").count();
    for (let i = 0; i < n; i++) await page.evaluate((i) => { const d = document.querySelectorAll("#main details.sec")[i]; if (!d.classList.contains("locked")) d.open = true; document.querySelectorAll("#main details").forEach((x) => { if (!x.classList.contains("locked")) x.open = true; }); }, i);
  }
  await page.evaluate(() => A.go({ dataset: { i: STEPS.findIndex((x) => x.id === "reqs") } }));
  await page.locator('#main tr[data-k^="req-"]').first().click();
  await page.keyboard.press("Escape");
  await page.locator("[data-act=relQuick]").click();
  await page.keyboard.press("Escape");
  await page.evaluate(() => A.go({ dataset: { i: STEPS.findIndex((x) => x.id === "backlog") } }));
  await page.locator('#main tr[data-k^="t-"]').first().click();
  await page.keyboard.press("Escape");
  for (const sel of ["#projBtn", "#userBtn", "#langBtn"]) { await page.locator(sel).click(); await page.keyboard.press("Escape"); }
  await page.locator("#rulesBtn").click();
  await page.locator("[data-act=closeRules]").click();
  await page.locator("#chatFab").click();
  await emptyReqs(page);
  await page.evaluate(() => A.go({ dataset: { i: STEPS.findIndex((x) => x.id === "reqs") } }));
  await page.waitForTimeout(300);
  const data = datiDiProva();
  const missing = (await page.evaluate(() => [...window.I18N.missing])).filter((s) => !isData(s, data));
  expect(missing, `testi senza traduzione (aggiungili in public/i18n-en.js, elenco completo: npm run i18n:mancanti)`).toEqual([]);
});
