// Kit e requisiti: le release usate dai requisiti devono esserci nel kit, e le epiche devono avere nomi diversi.
import { test, expect } from "@playwright/test";
import { openStudio, goToStep } from "./aiuti.mjs";

test.beforeEach(async ({ request }) => {
  await request.get("/__sim/reset");
});

const errori = (page) => page.evaluate(() => ticketList().filter((t) => issuesOf(t).e.length).length);

test("release dei requisiti non presenti nel kit: avviso, un solo clic per aggiungerle, e gli errori dei ticket spariscono", async ({ page }) => {
  await openStudio(page);
  // il kit conosce solo «Release 1» e «Release 2»; i requisiti e i ticket usano le release dei documenti
  await page.evaluate(async () => {
    await editKit((k) => { k.releases = [{ name: "Release 1", label: "Release1", date: "" }, { name: "Release 2", label: "Release2", date: "" }]; k.hier.phases = k.hier.phases.slice(0, 2); });
  });
  const miss = await page.evaluate(() => missingReleases());
  expect(miss.length).toBeGreaterThan(0);
  expect(await errori(page)).toBeGreaterThan(0);
  await goToStep(page, "Kit di progetto");
  await expect(page.locator("#main .card.warn", { hasText: "Release usate dai requisiti e non presenti nel kit" })).toContainText(miss[0]);
  await expect(page.locator("#main")).toContainText("Le release dei requisiti sono nel kit (K2)");
  await goToStep(page, "Backlog");
  await expect(page.locator("#main .card.warn", { hasText: "non presenti nel kit" })).toBeVisible();
  await goToStep(page, "Kit di progetto");
  await page.locator("[data-act=addReqReleases]").click();
  await expect(page.locator("#toast")).toContainText(/Release aggiunt[ae] al kit\./);
  expect(await page.evaluate(() => missingReleases())).toEqual([]);
  expect(await page.evaluate(() => ticketList().filter((t) => issuesOf(t).e.includes("Release non presente nel kit")).length)).toBe(0);
  const rel = await page.evaluate((m) => K().releases.filter((r) => m.includes(r.name)).map((r) => [r.name, r.label]), miss);
  expect(rel.length).toBe(miss.length);
  for (const [n, l] of rel) expect(l).toMatch(/^[A-Za-z0-9_-]+$/), expect(l.length).toBeGreaterThan(0), void n;
  expect(await page.evaluate((m) => (K().hier.phases || []).some((f) => m.includes(f.name)), miss)).toBe(true);
  await expect(page.locator("[data-act=addReqReleases]")).toHaveCount(0);
});

test("epiche con lo stesso nome: avviso e il controllo «Ogni epica ha un nome diverso» non è soddisfatto", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Kit di progetto");
  expect(await page.evaluate(() => dupEpics())).toEqual([]);
  await page.evaluate(async () => { await editKit((k) => { k.epics.push({ name: k.epics[0].name, release: k.releases[0]?.name || "", key: "" }); }); });
  const dup = await page.evaluate(() => dupEpics());
  expect(dup).toHaveLength(1);
  await expect(page.locator("#main .card.warn", { hasText: "Epiche con lo stesso nome" })).toContainText(dup[0]);
  expect(await page.evaluate(() => STEPS.find((s) => s.id === "kit").checks().find((c) => /nome diverso/.test(c.t)).ok)).toBe(false);
});

test("kit coerente (progetto di prova): nessun avviso e i controlli nuovi sono soddisfatti", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Kit di progetto");
  await expect(page.locator("#main .card.warn")).toHaveCount(0);
  expect(await page.evaluate(() => STEPS.find((s) => s.id === "kit").checks().filter((c) => /release dei requisiti|nome diverso/.test(c.t)).every((c) => c.ok))).toBe(true);
});
