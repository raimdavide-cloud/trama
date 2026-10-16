// Accessibilità WCAG 2.2 AA controllata con axe su tutte le pagine e su ogni passo dello studio.
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

for (const path of ["/", "/brand", "/installazione", "/privacy", "/componenti"]) {
  test(`accessibilità: pagina ${path}`, async ({ page }) => {
    await page.goto(path);
    await audit(page, path);
  });
}

test("accessibilità: pagina dei progetti", async ({ page }) => {
  await page.goto("/studio");
  await expect(page.locator(".proj-card")).toHaveCount(1);
  await audit(page, "progetti");
});

test("accessibilità: ogni passo dello studio, pannello e Regole", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(PROJECT);
  await expect(page.locator(".progress b")).toContainText("di 6 passi completati");
  for (const name of ["Progetto Jira", "Requisiti", "Domande di apertura", "Kit di progetto", "Backlog", "Crea su Jira", "Registro decisioni"]) {
    await page.locator("#stepList .st", { hasText: name }).click();
    if (name === "Crea su Jira") await expect(page.locator("#ackBox")).toBeVisible({ timeout: 20_000 });
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
