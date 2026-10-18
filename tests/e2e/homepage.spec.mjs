// Homepage: vantaggi per ruolo, header fisso con la sezione attiva nel menu, pulsanti secondo la sessione, demo e piè di pagina.
import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.get("/__sim/reset");
});

test("vantaggi: il filtro per ruolo mostra le schede di quel ruolo e quelle per tutto il team", async ({ page }) => {
  await page.goto("/");
  const cards = page.locator("#gains .gain");
  const all = await cards.count();
  expect(all).toBe(9);
  await expect(page.locator('.role-chip[aria-pressed="true"]')).toHaveText("Tutti");
  await page.locator(".role-chip", { hasText: /^QA$/ }).click();
  await expect(page.locator('.role-chip[aria-pressed="true"]')).toHaveText("QA");
  const visible = page.locator("#gains .gain:not([hidden])");
  await expect(visible.locator("h3")).toContainText(["Ticket chiari al primo colpo", "Scheda QA pronta per ogni ticket", "Piano di test per ogni release"]);
  for (const r of await visible.evaluateAll((els) => els.map((e) => e.dataset.roles))) expect(r.split(" ")).toContain("qa");
  expect(await visible.count()).toBeLessThan(all);
  await page.locator(".role-chip", { hasText: "Tutti" }).click();
  await expect(visible).toHaveCount(all);
});

test("header fisso: resta in alto e si compatta scorrendo; nel menu è evidenziata la sezione che si legge", async ({ page }) => {
  await page.goto("/");
  const top = page.locator("#siteTop");
  await expect(top).not.toHaveClass(/scrolled/);
  await page.locator("#menuBtn").click();
  await page.locator("#siteMenu").getByRole("menuitem", { name: "Esempi" }).click();
  await expect(top).toHaveClass(/scrolled/);
  expect((await top.boundingBox()).y).toBe(0);
  await expect(page.locator("#esempi h2")).toBeInViewport();
  // il titolo della sezione non finisce sotto l'header
  expect((await page.locator("#esempi .eyebrow").boundingBox()).y).toBeGreaterThanOrEqual((await top.boundingBox()).height - 1);
  await expect(page.locator('#siteMenu a[href="#esempi"]')).toHaveAttribute("aria-current", "true");
  await expect(page.locator('#siteMenu a[aria-current="true"]')).toHaveCount(1);
});

test("pulsanti principali: «Apri i tuoi progetti» con la sessione, «Accedi con Atlassian» senza", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#ctaMain")).toHaveText("Apri i tuoi progetti");
  await expect(page.locator("#ctaMain")).toHaveAttribute("href", "/studio");
  await expect(page.locator("#ctaBand")).toHaveText("Apri i tuoi progetti");
  await page.route("**/api/me?quiet=1", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"user":null}' }));
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.reload();
  await expect(page.locator("h1")).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.locator("#ctaMain")).toHaveText("Accedi con Atlassian");
  await expect(page.locator("#ctaMain")).toHaveAttribute("href", "/api/auth/login");
  expect(errors).toEqual([]);
});

test("demo: nell'hero il percorso breve dal documento a Jira, tra i capitoli la Scheda QA; Architettura nel piè di pagina", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#heroPlayer .p-title")).toHaveText("trama · dal documento a Jira");
  await expect(page.locator("#heroPlayer .fl")).toHaveCount(4);
  await expect(page.locator(".chapter")).toHaveCount(5);
  await page.locator(".chapter", { hasText: "Scheda QA per il collaudo" }).click();
  await expect(page.locator("#mainPlayer .p-title")).toHaveText("trama · Passo 5 di 6 · Scheda QA");
  await expect(page.locator("#mainPlayer .mdv")).toContainText("## Cosa verificare");
  await expect(page.locator("footer a", { hasText: "Architettura" })).toHaveAttribute("href", "/architettura");
  // le funzioni le fa Tessa; Claude Code resta solo nelle parti tecniche
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/Claude (legge|estrae|lo legge|scompone)|Chiedi a Claude|proposte di Claude|trascritte da Claude/);
});
