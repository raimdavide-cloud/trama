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

test("aggancio morbido: fermandosi vicino all'inizio di una sezione la pagina la allinea; dentro le sezioni lunghe e senza rotella niente scatti", async ({ page }) => {
  await page.goto("/");
  await page.mouse.move(700, 450);
  const startOf = (id) => page.evaluate((id) => Math.round(document.getElementById(id).getBoundingClientRect().top + scrollY) - 62, id);
  const settle = () => page.waitForTimeout(900);
  const y = () => page.evaluate(() => Math.round(scrollY));
  // 100 px prima di «Vantaggi», poi un colpo di rotella: si aggancia all'inizio della sezione
  const v = await startOf("vantaggi");
  await page.evaluate((t) => scrollTo({ top: t, behavior: "instant" }), v - 150);
  await page.mouse.wheel(0, 50);
  await expect.poll(y, { timeout: 4000 }).toBe(v);
  // appena oltre l'inizio di «Regole» (scorrendo verso l'alto): torna all'inizio
  const r = await startOf("regole");
  await page.evaluate((t) => scrollTo({ top: t, behavior: "instant" }), r + 140);
  await page.mouse.wheel(0, -50);
  await expect.poll(y, { timeout: 4000 }).toBe(r);
  // a metà di una sezione lunga si resta dove si è
  await page.evaluate((t) => scrollTo({ top: t, behavior: "instant" }), r + 250);
  await page.mouse.wheel(0, 50);
  await settle();
  expect(await y()).toBe(r + 300);
  // senza rotella (per esempio un link) niente aggancio
  await page.evaluate((t) => scrollTo({ top: t, behavior: "instant" }), v - 100);
  await settle();
  expect(await y()).toBe(v - 100);
});

test("aggancio morbido: spento per chi chiede meno animazioni", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/");
  await page.mouse.move(700, 450);
  const v = await page.evaluate(() => Math.round(document.getElementById("vantaggi").getBoundingClientRect().top + scrollY) - 62);
  await page.evaluate((t) => scrollTo({ top: t, behavior: "instant" }), v - 150);
  await page.mouse.wheel(0, 50);
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => Math.round(scrollY))).toBe(v - 100);
  await ctx.close();
});
