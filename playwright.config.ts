import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against the production build, served by
// scripts/e2e-server.ts with a throwaway database and signed-in test accounts.
// Specs are signed in as the test user unless they say otherwise.
//
// PARITY=vite|next runs only the visual-parity spec instead (see
// e2e/visual-parity.spec.ts); PARITY_BASE_URL points it at an already running
// server (the pre-migration build).
const parity = process.env.PARITY;
const external = process.env.PARITY_BASE_URL;
const signedIn = { storageState: "e2e/.auth/user.json" };

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // On GitHub Actions, failures are also shown as annotations on the run page,
  // which can be read without signing in (the full log cannot).
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: external ?? "http://localhost:8080",
    trace: "on-first-retry",
  },
  projects: parity
    ? [
        {
          name: "parity",
          testMatch: /visual-parity\.spec\.ts/,
          use: { ...devices["Desktop Chrome"], ...(parity === "vite" ? {} : signedIn) },
          snapshotPathTemplate: "{testDir}/.parity-baseline/{arg}{ext}",
        },
      ]
    : [
        { name: "chromium", use: { ...devices["Desktop Chrome"], ...signedIn }, testIgnore: /visual-parity/ },
        // Safari/WebKit on iPhone — the mobile navigation, touch and sign-in checks.
        {
          name: "iphone-webkit",
          use: { ...devices["iPhone 13"], ...signedIn },
          testMatch: /(navigation|auth|accounts|journey|password|admin|i18n|accessibility)\.spec\.ts/,
          grep: /mobile/,
        },
      ],
  // Always a fresh build and a freshly seeded database: never a leftover
  // server that happens to be listening on the port.
  webServer: external
    ? undefined
    : {
        command: "npm run build && npm run e2e:server",
        url: "http://localhost:8080/api/health?ready=1",
        reuseExistingServer: false,
        timeout: 300_000,
      },
});
