// Test end-to-end dello studio contro il simulatore (tests/sim/server.mjs): niente database, niente Jira vero.
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.SIM_PORT || 8899);
const CI = !!process.env.CI;

export default defineConfig({
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1, // il simulatore tiene i dati in memoria: un test alla volta
  retries: CI ? 1 : 0,
  reporter: CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 }, // si prova solo su desktop
    locale: "it-IT",
    trace: "retain-on-failure",
    ...(CI ? {} : { channel: "chrome" }), // in locale usa Chrome già installato, nessun download
  },
  projects: [
    { name: "e2e", testDir: "tests/e2e", testMatch: /\.spec\.mjs$/ },
    { name: "visual", testDir: "tests/visual", testMatch: /\.visual\.mjs$/ }, // solo in locale: npm run test:visual
  ],
  snapshotPathTemplate: "tests/visual/riferimenti/{arg}{ext}",
  webServer: {
    command: "node tests/sim/server.mjs",
    url: `http://127.0.0.1:${PORT}/api/me`,
    reuseExistingServer: !CI,
    env: { PORT: String(PORT) },
  },
});
