import { defineConfig, devices } from "@playwright/test";

// Standard Playwright config. Add end-to-end specs under `e2e/` (or adjust
// `testDir`) and run them with `npx playwright test`.
//
// PARITY=vite|next runs only the visual-parity spec instead (see
// e2e/visual-parity.spec.ts); PARITY_BASE_URL points it at an already running
// server.
const parity = process.env.PARITY;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  use: {
    baseURL: process.env.PARITY_BASE_URL ?? "http://localhost:8080",
    trace: "on-first-retry",
  },
  projects: parity
    ? [
        {
          name: "parity",
          testMatch: /visual-parity\.spec\.ts/,
          use: { ...devices["Desktop Chrome"] },
          snapshotPathTemplate: "{testDir}/.parity-baseline/{arg}{ext}",
        },
      ]
    : [
        { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /visual-parity/ },
        // Safari/WebKit on iPhone — the mobile navigation + touch regressions.
        {
          name: "iphone-webkit",
          use: { ...devices["iPhone 13"] },
          testMatch: /navigation\.spec\.ts/,
          grep: /mobile/,
        },
      ],
  // Tests run against a production build (next start), not the dev server: it
  // is what ships, and it does not compile routes on first visit mid-test.
  webServer: process.env.PARITY_BASE_URL
    ? undefined
    : {
        command: "npm run build && npm run start",
        url: "http://localhost:8080",
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
      },
});
