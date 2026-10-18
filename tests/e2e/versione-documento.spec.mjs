// Nuova versione del documento: confronto con i requisiti attuali, scelta di cosa applicare, ticket «da rivedere» con il motivo.
import { test, expect } from "@playwright/test";
import { openStudio, goToStep, openSec } from "./aiuti.mjs";

test.beforeEach(async ({ request }) => {
  await request.get("/__sim/reset");
});

test("nuova versione: nuovi, cambiati e rimossi; applicando, i ticket coinvolti diventano «da rivedere» e la versione va nel registro", async ({ page }) => {
  await openStudio(page);
  // la «v2» del documento: RF-001 cambia release, RF-002 sparisce, arriva un requisito nuovo; il resto è invariato
  const ctx = await page.evaluate(() => {
    const doc = arr("docs")[0];
    const reqs = reqList().filter((r) => r.source === doc.name);
    const [r1, r2] = reqs;
    const id = uid();
    put("docs", id, { name: "requisiti-ortocomune-v2.md", kind: "Markdown", text: "versione 2", chars: 10, at: Date.now() });
    window.ask = async () => ({ requirements: [
      { sameAs: r1.code, title: r1.title, desc: r1.desc, components: r1.components, release: "Release 1.0", ui: r1.ui, extDeps: r1.extDeps, intDeps: r1.intDeps },
      ...reqs.slice(2).map((r) => ({ sameAs: r.code, title: r.title, desc: r.desc, components: r.components, release: r.release, ui: r.ui, extDeps: r.extDeps, intDeps: r.intDeps })),
      { sameAs: "", sourceId: "RF-900", title: "Esportazione del diario in PDF", desc: "L'ortolano scarica il diario.", components: ["Web App"], release: "Release 1.0" },
    ] });
    SAMPLE = SAMPLE || { ok: true };
    return { doc: id, r1: r1.code, r2: r2.code, t1: ticketList().filter((t) => t.req === r1.code).length, t2: ticketList().filter((t) => t.req === r2.code).length };
  });
  await goToStep(page, "Requisiti");
  await openSec(page, "Documenti");
  await page.locator(`#main details.item[data-k="doc-${ctx.doc}"] > summary`).click();
  await page.locator(`#main details.item[data-k="doc-${ctx.doc}"] [data-act=compareDoc]`).click();
  const sp = page.locator(".sp");
  await expect(sp).toContainText("Nuova versione: requisiti-ortocomune-v2.md");
  await expect(sp.locator(".sp-sec", { hasText: "Nuovi" })).toContainText("RF-900 · Esportazione del diario in PDF");
  await expect(sp.locator(".sp-sec", { hasText: "Cambiati" })).toContainText(`${ctx.r1} · release:`);
  await expect(sp.locator(".sp-sec", { hasText: "Non più nel documento" })).toContainText(ctx.r2);
  const go = sp.locator("[data-act=docDiffApply]");
  await expect(go).toHaveText("Applica 3 modifiche");
  await go.click();
  await go.click();
  await expect(page.locator("#toast")).toContainText(`${ctx.t1 + ctx.t2} ticket da rivedere`);
  const after = await page.evaluate((c) => ({
    r1: reqList().find((r) => r.code === c.r1).release,
    r2: !!reqList().find((r) => r.code === c.r2).removed,
    nuovo: reqList().find((r) => r.code === "RF-900")?.title,
    review: ticketList().filter((t) => t.review).map((t) => t.req).sort(),
    dec: arr("decisions").some((d) => d.text.startsWith("Nuova versione del documento «requisiti-ortocomune-v2.md»: 1 requisito nuovo, 1 cambiato, 1 non più presente.")),
  }), ctx);
  expect(after.r1).toBe("Release 1.0");
  expect(after.r2).toBe(true);
  expect(after.nuovo).toBe("Esportazione del diario in PDF");
  expect(after.review).toEqual([...Array(ctx.t1).fill(ctx.r1), ...Array(ctx.t2).fill(ctx.r2)].sort());
  expect(after.dec).toBe(true);
  // nel Backlog: «da rivedere», il gruppo dice «requisito rimosso», e il rimosso non conta tra i «senza ticket»
  await goToStep(page, "Backlog");
  await page.evaluate(() => { T.rel = "*"; render(); }); // il requisito ora è in un'altra release: tutte le release
  await openSec(page, "Ticket per requisito");
  const t = await page.evaluate((c) => ticketList().find((x) => x.req === c.r1), ctx);
  await expect(page.locator(`#main tr[data-id="${t.id}"] .dt-st`)).toContainText("da rivedere");
  await expect(page.locator("#main .dt-gh", { hasText: ctx.r2 })).toContainText("requisito rimosso");
  await page.locator(`#main tr[data-id="${t.id}"]`).click();
  await expect(page.locator(".sp .msg.warn").first()).toContainText(`il requisito ${ctx.r1} è cambiato in «requisiti-ortocomune-v2.md» (release).`);
  await page.locator(".sp").getByRole("button", { name: "Segna come rivisto" }).click();
  expect(await page.evaluate((id) => !!S.tickets[id].review, t.id)).toBe(false);
});

test("si può escludere una modifica e annullare tutto subito dopo", async ({ page }) => {
  await openStudio(page);
  const ctx = await page.evaluate(() => {
    const doc = arr("docs")[0], reqs = reqList().filter((r) => r.source === doc.name);
    const id = uid();
    put("docs", id, { name: "requisiti-v3.md", kind: "Markdown", text: "v3", chars: 2, at: Date.now() });
    window.ask = async () => ({ requirements: reqs.map((r, i) => ({ sameAs: r.code, title: i === 0 ? r.title + " (rivisto)" : r.title, desc: r.desc, components: r.components, release: r.release, ui: r.ui, extDeps: r.extDeps, intDeps: r.intDeps })) });
    SAMPLE = SAMPLE || { ok: true };
    return { doc: id, code: reqs[0].code, title: reqs[0].title };
  });
  await goToStep(page, "Requisiti");
  await page.evaluate((id) => A.compareDoc({ dataset: { id } }), ctx.doc);
  const sp = page.locator(".sp");
  await expect(sp.locator("[data-act=docDiffApply]")).toHaveText("Applica 1 modifica");
  await sp.locator(".dd-pick").first().uncheck();
  await expect(sp.locator("[data-act=docDiffApply]")).toBeDisabled();
  await sp.locator(".dd-pick").first().check();
  await sp.locator("[data-act=docDiffApply]").click();
  await sp.locator("[data-act=docDiffApply]").click();
  await page.locator(".toast-undo").click();
  await expect(page.locator("#toast")).toHaveText("Versione del documento non applicata.");
  expect(await page.evaluate((c) => [reqList().find((r) => r.code === c.code).title, ticketList().some((t) => t.review)], ctx)).toEqual([ctx.title, false]);
});
