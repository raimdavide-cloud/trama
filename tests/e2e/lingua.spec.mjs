// Lingua dell'interfaccia: switch nell'header, memoria della scelta, copertura dell'inglese. I dati non si traducono.
import { test, expect } from "@playwright/test";
import { openStudio, goToStep, PROJECT, emptyReqs } from "./aiuti.mjs";
import { datiDiProva, isData } from "../../scripts/i18n/filtro.mjs";
import { homeMissing } from "../../scripts/i18n/home.mjs";

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
  // selezione dei ticket, scheda Qualità e kit da un modello
  await page.evaluate(() => A.go({ dataset: { i: STEPS.findIndex((x) => x.id === "backlog") } }));
  await page.locator(".t-pick").first().check();
  await page.locator("[data-act=bTab][data-tab=quality]").click();
  await page.evaluate(() => A.go({ dataset: { i: STEPS.findIndex((x) => x.id === "kit") } }));
  await page.locator("[data-act=kitImport]").click();
  await page.locator("#kiSrc").selectOption("tpl:iot");
  await page.keyboard.press("Escape");
  // ticket «da aggiornare» e «da rivedere», con una collega che lo guarda e lo ha appena cambiato
  await page.evaluate(() => {
    const t = ticketList()[0];
    put("tickets", t.id, { ...S.tickets[t.id], state: "created", key: "ORTO-1", pushed: { summary: "old", desc: "", labels: [], epic: "" }, review: { why: `il requisito ${t.req} è cambiato in «v2.md» (release).`, at: Date.now() } });
    S.presence = { ...S.presence, laura: { name: "Laura Bianchi", at: Date.now(), step: "backlog", stepName: "Backlog", panel: "ticket:" + t.id, panelRef: t.ref } };
    (T.remote ||= {})[t.id] = { by: "laura", at: Date.now() };
    A.go({ dataset: { i: STEPS.findIndex((x) => x.id === "backlog") } });
    T.panel = { kind: "ticket", id: t.id }; render(); renderPresence();
  });
  await page.keyboard.press("Escape");
  // confronto con una nuova versione del documento (risposta di Tessa simulata)
  await page.evaluate(async () => {
    const r = reqList(); window.ask = async () => ({ requirements: [{ sameAs: r[0].code, title: r[0].title, release: "Release 9" }, { sourceId: "RF-999", title: "New one" }] });
    SAMPLE = SAMPLE || { ok: true };
    A.go({ dataset: { i: STEPS.findIndex((x) => x.id === "reqs") } });
    await A.compareDoc({ dataset: { id: arr("docs")[0].id } });
  });
  await expect(page.locator(".sp")).toBeVisible();
  await page.keyboard.press("Escape");
  await emptyReqs(page);
  await page.evaluate(() => A.go({ dataset: { i: STEPS.findIndex((x) => x.id === "reqs") } }));
  await page.waitForTimeout(300);
  const data = datiDiProva();
  const missing = (await page.evaluate(() => [...window.I18N.missing])).filter((s) => !isData(s, data));
  expect(missing, `testi senza traduzione (aggiungili in public/i18n-en.js, elenco completo: npm run i18n:mancanti)`).toEqual([]);
});

test("homepage: sezioni e lingua in un solo menu nell'header, «Apri Trama» resta fuori; la lingua vale anche dentro Trama", async ({ page }) => {
  await page.goto("/");
  const nav = page.locator("nav.top");
  // nell'header restano solo marchio, menu e «Apri Trama»
  await expect(nav.locator(":scope > *")).toHaveCount(3);
  await expect(nav.locator(":scope > a.btn.primary")).toHaveText("Apri Trama");
  const btn = nav.locator("#menuBtn"), menu = page.locator("#siteMenu");
  await expect(btn).toContainText("Menu");
  await btn.click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText(["Il filo", "Vantaggi", "Come funziona", "Demo", "Esempi", "Regole", "Sicurezza", "Domande"]);
  await expect(menu.locator('[data-lang="it"]')).toHaveAttribute("aria-checked", "true");
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("End");
  await expect(menu.locator('[data-lang="en"]')).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(btn).toBeFocused();
  // una sezione: il menu si chiude e la pagina va lì
  await btn.click();
  await menu.getByRole("menuitem", { name: "Vantaggi" }).click();
  await expect(menu).toBeHidden();
  await expect(page).toHaveURL(/#vantaggi$/);
  await expect(page.locator("#vantaggi h2")).toBeInViewport();
  // le sezioni sono nello stesso ordine delle voci del menu
  const ids = await page.locator("#siteMenu a[role=menuitem]").evaluateAll((as) => as.map((a) => a.getAttribute("href").slice(1)));
  const order = await page.locator("section[id]").evaluateAll((ss) => ss.map((s) => s.id));
  expect(order).toEqual(ids);
  // la lingua
  await btn.click();
  await menu.locator('[data-lang="en"]').click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("h1")).toContainText("From document to backlog");
  await expect(nav).toContainText("Open Trama");
  await expect(page.locator("#vantaggi h2")).toHaveText("Trama prepares, the whole team gains.");
  // stessa scelta dentro Trama
  await page.goto(PROJECT);
  await expect(page.locator(".progress b")).toHaveText(/steps completed/);
  await page.goto("/");
  await page.locator("#menuBtn").click();
  await page.locator('#siteMenu [data-lang="it"]').click();
  await expect(page.locator("h1")).toContainText("Dal documento al backlog");
});

test("homepage in inglese: nessun testo resta in italiano, demo ed esempi compresi", async ({ page, context }) => {
  await context.addInitScript(() => { try { localStorage.setItem("trama:lang", "en"); } catch {} });
  const missing = await homeMissing(page);
  expect(missing, "testi senza traduzione (aggiungili in public/i18n-home-en.js, elenco: npm run i18n:mancanti-home)").toEqual([]);
});

test("homepage: ?lang=en mostra l'inglese indicizzabile (canonico, meta, og:locale) e tornando all'italiano il parametro sparisce", async ({ page }) => {
  await page.goto("/?lang=en#faq");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).not.toHaveClass(/i18n-wait/);
  await expect(page.locator("h1")).toContainText("From document to backlog");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\?lang=en$/);
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute("content", "en_GB");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /^Trama turns the requirements document/);
  expect(await page.evaluate(() => typeof window.TRAMA_EN)).toBe("object");
  await page.locator("#menuBtn").click();
  await page.locator('#siteMenu [data-lang="it"]').click();
  await expect(page.locator("h1")).toContainText("Dal documento al backlog");
  await expect(page).not.toHaveURL(/lang=/);
});

test("homepage in italiano: il dizionario inglese non si scarica", async ({ page }) => {
  const asked = [];
  page.on("request", (r) => asked.push(r.url()));
  await page.goto("/");
  await expect(page.locator("h1")).toContainText("Dal documento al backlog");
  expect(asked.some((u) => u.includes("i18n-home-en.js"))).toBe(false);
  expect(asked.some((u) => /fonts\.(googleapis|gstatic)\.com/.test(u))).toBe(false);
});
