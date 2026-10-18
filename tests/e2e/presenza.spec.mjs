// Presenza: chi altro ha il progetto aperto, chi guarda lo stesso ticket, avviso quando un collega lo modifica.
import { test, expect } from "@playwright/test";
import { openStudio, goToStep, PROJECT } from "./aiuti.mjs";

test.beforeEach(async ({ request }) => {
  await request.get("/__sim/reset");
});

const PID = PROJECT.split("p=")[1];
const asLaura = { headers: { "x-sim-by": "laura-1" } };

test("colleghi nel progetto: avatar nell'header, «sta guardando questo ticket», avviso quando lo modifica", async ({ page, request }) => {
  await openStudio(page);
  await goToStep(page, "Backlog");
  const t = await page.evaluate(() => { const t = ticketList()[1]; return { id: t.id, ref: t.ref, data: S.tickets[t.id] }; });
  // la propria presenza si scrive da sola
  await expect.poll(async () => (await (await request.get(`/api/projects/${PID}`)).json()).items.some((i) => i.col === "presence" && i.data.step === "backlog")).toBe(true);
  // Laura apre lo stesso ticket
  await request.put(`/api/projects/${PID}/items/presence/laura-1`, { ...asLaura, data: { name: "Laura Bianchi", at: Date.now(), step: "backlog", stepName: "Backlog", panel: "ticket:" + t.id, panelRef: t.ref } });
  await page.evaluate(() => DB.poll());
  await expect(page.locator("#presence")).toBeVisible();
  await expect(page.locator("#presence .pres-av")).toHaveText("LB");
  await expect(page.locator("#presence .pres-av")).toHaveAttribute("title", `Laura Bianchi · Backlog · ${t.ref}`);
  await page.locator(`#main tr[data-id="${t.id}"]`).click();
  const sp = page.locator(".sp");
  await expect(sp.locator(".peers")).toContainText("Laura Bianchi sta guardando questo ticket.");
  // Laura lo modifica: chi ha il pannello aperto lo vede subito
  await request.put(`/api/projects/${PID}/items/tickets/${t.id}`, { ...asLaura, data: { ...t.data, title: "Changed by Laura" } });
  await page.evaluate(() => DB.poll());
  await expect(sp.locator(".msg.warn").first()).toContainText("Laura Bianchi ha appena modificato questo ticket.");
  await expect(sp.locator('[data-bind$=":title"]')).toHaveValue("Changed by Laura");
});

test("presenza scaduta (più di 75 secondi) non si mostra", async ({ page, request }) => {
  await openStudio(page);
  await request.put(`/api/projects/${PID}/items/presence/laura-1`, { ...asLaura, data: { name: "Laura Bianchi", at: Date.now() - 120000, step: "reqs", stepName: "Requisiti" } });
  await page.evaluate(() => DB.poll());
  await expect(page.locator("#presence")).toBeHidden();
});
