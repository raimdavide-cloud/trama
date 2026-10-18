// Testi della homepage in inglese ancora senza traduzione: apre ogni demo e ogni esempio e fa passare le didascalie di tutti i passi.
// Usata da scripts/i18n/raccogli-home.mjs e dal test e2e della lingua.
export async function homeMissing(page, base = "") {
  await page.goto(base + "/");
  await page.waitForFunction(() => !!window.I18N);
  for (const c of await page.locator(".chapter").all()) await c.click();
  for (const t of await page.locator(".tabs .tab").all()) await t.click();
  await page.locator("#langBtn").click(); await page.keyboard.press("Escape");
  return page.evaluate(() => {
    for (const d of Object.values(DEMOS)) { I18N.t(d.title); I18N.t("Demo animata: " + d.title); d.steps.forEach((s) => I18N.t(s)); }
    return [...I18N.missing].filter((s) => !/^[A-Z][A-Z0-9]*-\d+$/.test(s)).sort(); // le chiavi (RF-013, COM-901) sono dati
  });
}
