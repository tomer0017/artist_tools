import { defineConfig, devices } from "@playwright/test";

// Standard Playwright config. Add end-to-end specs under `e2e/` (or adjust
// `testDir`) and run them with `npx playwright test`.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  use: {
    baseURL: "http://localhost:8080",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Safari/WebKit on iPhone — the mobile navigation + touch regressions.
    {
      name: "iphone-webkit",
      use: { ...devices["iPhone 13"] },
      testMatch: /navigation\.spec\.ts/,
      grep: /mobile/,
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:8080",
    reuseExistingServer: !process.env.CI,
  },
});
