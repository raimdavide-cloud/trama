// Accessibilità WCAG 2.2 AA controllata con axe su tutte le pagine e su ogni passo di Trama.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const PROJECT = "/studio?p=progetto-prova";

async function audit(page, label) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).exclude(".player").analyze();
  const report = violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.slice(0, 4).map((n) => `    ${n.target.join(" ")}`).join("\n")}`);
  expect.soft(report, `${label}\n${report.join("\n")}`).toEqual([]);
}

test.use({ reducedMotion: "reduce" }); // come chi ha disattivato le animazioni: niente transizioni a metà durante il controllo

test.beforeEach(async ({ request }) => {
  await request.get("/__sim/reset");
});

for (const path of ["/", "/brand", "/installazione", "/privacy", "/componenti", "/architettura"]) {
  test(`accessibilità: pagina ${path}`, async ({ page }) => {
    await page.goto(path);
    await audit(page, path);
  });
}

test("accessibilità: domande con una selezione attiva e un cestino armato", async ({ page }) => {
  await page.goto(PROJECT);
  await page.locator("#stepList .st", { hasText: "Domande di apertura" }).click();
  if ((await page.locator("[data-act=secAll]").textContent()) === "Apri tutto") await page.locator("[data-act=secAll]").click();
  await page.locator("#main .q-pick").nth(0).check();
  await page.locator("#main .q-pick").nth(1).check();
  await page.locator("#main .q-del").nth(3).click();
  await expect(page.locator("#main .q-bar")).toBeVisible();
  await audit(page, "domande selezionate");
});

test("accessibilità: homepage in inglese con il menu della lingua aperto", async ({ page, context }) => {
  await context.addInitScript(() => { try { localStorage.setItem("trama:lang", "en"); } catch {} });
  await page.goto("/");
  await page.locator("#langBtn").click();
  await expect(page.locator("#langMenu")).toBeVisible();
  await audit(page, "homepage in inglese");
});

test("accessibilità: pagina dei progetti", async ({ page }) => {
  await page.goto("/studio");
  await expect(page.locator(".proj-card")).toHaveCount(1);
  await audit(page, "progetti");
});

test("accessibilità: ogni passo di Trama, pannello e Regole", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(PROJECT);
  await expect(page.locator(".progress b")).toContainText("di 6 passi completati");
  for (const name of ["Progetto Jira", "Requisiti", "Domande di apertura", "Kit di progetto", "Backlog", "Crea su Jira", "Registro decisioni"]) {
    await page.locator("#stepList .st", { hasText: name }).click();
    if (name === "Crea su Jira") await expect(page.locator('#main details.sec[data-sec="create:controllo-prima-della-creazione"] .sec-go')).toHaveAttribute("aria-disabled", "false", { timeout: 20_000 }); // controllo finito
    await audit(page, name);
  }
  await page.locator("#stepList .st", { hasText: "Requisiti" }).click();
  await page.locator('#main tr[data-k^="req-"]').first().click();
  await expect(page.locator(".sp")).toBeVisible();
  await audit(page, "pannello di un requisito");
  await page.keyboard.press("Escape");
  await page.locator("#rulesBtn").click();
  await audit(page, "Regole del playbook");
  await page.locator("#capChips button").click();
  await audit(page, "pannello Collegamenti");
});

test("accessibilità: progetto nuovo, pannelli, assegnazione rapida, menu e chat", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(PROJECT);
  await expect(page.locator(".progress b")).toContainText("di 6 passi completati");
  await page.locator("#stepList .st", { hasText: "Backlog" }).click();
  await page.locator('#main tr[data-k^="t-"]').first().click();
  await expect(page.locator(".sp")).toBeVisible();
  await audit(page, "pannello di un ticket");
  await page.keyboard.press("Escape");
  await page.locator("#stepList .st", { hasText: "Requisiti" }).click();
  await page.locator("[data-act=relQuick]").click();
  await audit(page, "assegnazione rapida della release");
  await page.keyboard.press("Escape");
  await page.evaluate(() => { for (const c of ["docs", "reqs"]) for (const k of Object.keys(S[c])) del(c, k); });
  await expect(page.locator("#main details.sec.locked")).toHaveCount(2);
  await audit(page, "progetto nuovo con step bloccati");
  await page.locator("#projBtn").click();
  await audit(page, "menu del progetto");
  await page.keyboard.press("Escape");
  await page.locator("#chatFab").click();
  await expect(page.locator("#chat")).toHaveClass(/open/);
  await audit(page, "chat aperta");
});

test.describe("modalità scura", () => {
  test.use({ colorScheme: "dark" });
  for (const path of ["/", "/installazione", "/componenti"]) {
    test(`accessibilità in modalità scura: pagina ${path}`, async ({ page }) => {
      await page.goto(path);
      await audit(page, `${path} (scuro)`);
    });
  }
  test("accessibilità in modalità scura: passi di Trama", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(PROJECT);
    await expect(page.locator(".progress b")).toContainText("di 6 passi completati");
    for (const name of ["Requisiti", "Kit di progetto", "Backlog", "Crea su Jira"]) {
      await page.locator("#stepList .st", { hasText: name }).click();
      if (name === "Crea su Jira") await expect(page.locator('#main details.sec[data-sec="create:controllo-prima-della-creazione"] .sec-go')).toHaveAttribute("aria-disabled", "false", { timeout: 20_000 });
      await audit(page, `${name} (scuro)`);
    }
  });
});

test.describe("in inglese", () => {
  test.beforeEach(async ({ context }) => { await context.addInitScript(() => { try { localStorage.setItem("trama:lang", "en"); } catch {} }); });
  test("accessibilità in inglese: passi di Trama e menu della lingua", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(PROJECT);
    await expect(page.locator(".progress b")).toHaveText(/steps completed/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    for (const id of ["reqs", "kit", "backlog"]) {
      await page.evaluate((id) => A.go({ dataset: { i: STEPS.findIndex((x) => x.id === id) } }), id);
      await audit(page, `${id} (inglese)`);
    }
    await page.locator("#langBtn").click();
    await audit(page, "menu della lingua (inglese)");
  });
});
