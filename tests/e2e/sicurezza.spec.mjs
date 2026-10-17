// Content-Security-Policy: nessuna violazione su tutte le pagine pubbliche e su ogni passo di Trama.
// Il simulatore invia la stessa politica della produzione (vercel.json); qui si ascolta securitypolicyviolation,
// che il browser emette anche in sola segnalazione (Report-Only).
import { test, expect } from "@playwright/test";
import { openStudio, goToStep } from "./aiuti.mjs";

let violations;

test.beforeEach(async ({ page, request }) => {
  await request.get("/__sim/reset");
  violations = [];
  await page.exposeFunction("__cspViolation", (v) => violations.push(v));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__cspViolation(`${e.effectiveDirective} ${e.blockedURI || "-"} su ${location.pathname} (${e.sourceFile || "?"}:${e.lineNumber})`));
  });
});

const noViolations = async (page, label) => {
  await page.waitForTimeout(150); // gli eventi arrivano in modo asincrono
  expect(violations, `violazioni della CSP: ${label}`).toEqual([]);
};

test("la politica arriva in sola segnalazione su pagine, file e API", async ({ request }) => {
  for (const path of ["/", "/studio", "/studio-app.js", "/api/me"]) {
    const h = (await request.get(path)).headers();
    expect(h["content-security-policy-report-only"], path).toContain("script-src 'self' https://cdnjs.cloudflare.com");
    expect(h["content-security-policy"], path).toBeUndefined();
  }
  const r = await request.post("/api/csp-report", { data: { "csp-report": { "effective-directive": "img-src" } } });
  expect(r.status()).toBe(204);
});

for (const path of ["/", "/brand", "/installazione", "/privacy", "/componenti", "/architettura"]) {
  test(`CSP: pagina ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.mouse.wheel(0, 4000); // le demo della home partono quando entrano in vista
    await noViolations(page, path);
  });
}

test("CSP: pagina dei progetti, ogni passo di Trama, pannelli, Regole e chat", async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.goto("/studio");
  await expect(page.locator(".proj-card")).toHaveCount(1);
  await noViolations(page, "progetti");
  await openStudio(page);
  for (const name of ["Progetto Jira", "Requisiti", "Domande di apertura", "Kit di progetto", "Backlog", "Crea su Jira", "Registro decisioni"]) {
    await goToStep(page, name);
    if (name === "Crea su Jira") await expect(page.locator('#main details.sec[data-sec="create:controllo-prima-della-creazione"] .sec-go')).toHaveAttribute("aria-disabled", "false", { timeout: 20_000 });
    await noViolations(page, name);
  }
  await goToStep(page, "Requisiti");
  await page.locator('#main tr[data-k^="req-"]').first().click();
  await expect(page.locator(".sp")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator("#rulesBtn").click();
  await page.locator("#capChips button").click();
  await page.locator("#chatFab").click();
  await expect(page.locator("#chat")).toHaveClass(/open/);
  await noViolations(page, "pannelli, Regole e chat");
  expect((await (await request.get("/__sim/csp")).json()).reports).toEqual([]);
});

test("CSP: un Word si legge con la libreria da cdnjs senza violazioni", async ({ page }) => {
  // la libreria vera non serve: conta che il browser accetti lo script da cdnjs
  await page.route("https://cdnjs.cloudflare.com/ajax/libs/mammoth/**", (route) =>
    route.fulfill({ contentType: "text/javascript", body: 'window.mammoth={extractRawText:async()=>({value:"Il sistema deve permettere la prenotazione."})};' }));
  await openStudio(page);
  await goToStep(page, "Requisiti");
  await page.locator("#fileIn").setInputFiles({ name: "capitolato.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("finto") });
  await page.waitForFunction(() => Object.values(S.docs).some((d) => d.name === "capitolato.docx" && d.kind === "Word"));
  await noViolations(page, "caricamento di un Word");
});
