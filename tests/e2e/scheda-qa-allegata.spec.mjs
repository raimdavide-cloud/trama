// Scheda QA: non è più un riquadro né uno zip da scaricare; a fine creazione il suo .md si allega alle Story su Jira.
import { test, expect } from "@playwright/test";
import { openStudio, goToStep, toAck, runCreate, DONE, simState, openSec } from "./aiuti.mjs";

test.beforeEach(async ({ request }) => {
  await request.get("/__sim/reset");
});

test("nel Backlog non c'è più la scheda QA da scaricare: né nel pannello del ticket né nell'esportazione", async ({ page }) => {
  await openStudio(page);
  await goToStep(page, "Backlog");
  const ref = await page.evaluate(() => ticketList().find((t) => t.type === "Story").ref);
  await page.locator(`#main tr[data-k^="t-"]`, { hasText: ref }).first().click();
  await expect(page.locator(".sp")).toBeVisible();
  await expect(page.locator(".sp .qa-box, .sp [data-act=qaDownload]")).toHaveCount(0);
  await expect(page.locator("[data-act=qaZip]")).toHaveCount(0);
});

test("a fine creazione ogni Story ha la sua scheda .md allegata su Jira; UX Story, epiche e struttura no", async ({ page, request }) => {
  test.setTimeout(240_000);
  await openStudio(page);
  await goToStep(page, "Crea su Jira");
  await toAck(page);
  await runCreate(page);
  await expect(page.locator("#main")).toContainText(DONE, { timeout: 200_000 });
  const st = await simState(request);
  const stories = st.issues.filter((i) => i.type === "Story");
  expect(stories.length).toBeGreaterThan(10);
  for (const i of stories) {
    expect(i.attachments, `${i.key} ha un solo allegato`).toHaveLength(1);
    const [a] = i.attachments;
    expect(a.filename).toMatch(new RegExp(`^${i.key}-[a-z0-9-]+\\.md$`));
    expect(a.text).toContain("## Cosa verificare");
    expect(a.text).toContain(`ticket: ${i.key}`);
  }
  for (const i of st.issues.filter((i) => i.type !== "Story")) expect(i.attachments, `${i.key} (${i.type}) senza scheda`).toHaveLength(0);
  expect(await page.evaluate(() => ticketList().filter((t) => t.type === "Story" && t.state === "created").every((t) => !!t.qaFile))).toBe(true);
  await expect(page.locator("#main")).toContainText(/\d+ schede QA allegate alle storie\./);
  // niente da ripetere: la casella delle modifiche non ne parla
  await openSec(page, "Sincronizzazione con Jira");
  await expect(page.locator(".push-box")).not.toContainText("scheda QA da allegare");
  await expect(page.locator(".push-box")).not.toContainText("schede QA da allegare");
});

test("se gli allegati falliscono la creazione finisce lo stesso, si dice cosa manca e «Controlla e aggiorna Jira» li allega", async ({ page, request }) => {
  test.setTimeout(240_000);
  await openStudio(page);
  await goToStep(page, "Crea su Jira");
  await toAck(page);
  // ogni chiave del progetto di prova: il primo allegato di ciascun ticket fallisce con 500
  for (let n = 1001; n <= 1140; n++) await request.post("/__sim/fault", { data: { kind: "attach500", type: `ORTO-${n}`, times: 1 } });
  await runCreate(page);
  await expect(page.locator("#main")).toContainText(DONE, { timeout: 200_000 });
  let st = await simState(request);
  const stories = st.issues.filter((i) => i.type === "Story");
  expect(stories.every((i) => i.attachments.length === 0)).toBe(true);
  await expect(page.locator("#main")).toContainText(`${stories[0].key}: scheda QA non allegata`);
  await expect(page.locator("#main")).toContainText(`${stories.length} schede QA da allegare: si completa da`);
  await openSec(page, "Sincronizzazione con Jira");
  const sec = page.locator('#main details.sec[data-sec="create:sincronizzazione-con-jira"]');
  await expect(sec.locator(".push-box")).toContainText(`${stories.length} schede QA da allegare`);
  await sec.getByRole("button", { name: "Controlla e aggiorna Jira" }).click();
  await expect(sec).toContainText(`${stories.length} schede QA da allegare`);
  await sec.getByRole("button", { name: "Conferma: aggiorna Jira" }).click();
  await expect(page.locator("#main")).toContainText(`${stories.length} schede QA allegate`, { timeout: 120_000 });
  st = await simState(request);
  expect(st.issues.filter((i) => i.type === "Story").every((i) => i.attachments.length === 1)).toBe(true);
  await expect(sec.locator(".push-box")).not.toContainText("da allegare");
});
