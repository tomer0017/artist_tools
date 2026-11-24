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
        { name: "chromium", use: { ...devices["Desktop Chrome"], ...signedIn }, testIgnore: /visual-parity|google-only|username-accounts|entitlements|learn-admin|companion-admin/ },
        // Safari/WebKit on iPhone — the mobile navigation, touch and sign-in checks.
        {
          name: "iphone-webkit",
          use: { ...devices["iPhone 13"], ...signedIn },
          testMatch: /(navigation|auth|accounts|journey|password|admin|i18n|accessibility|sketch|color|grid|worksheets|study|learn-screens|companion)\.spec\.ts/,
          // (username-accounts.spec.ts and entitlements.spec.ts run on the staging-like servers below.)
          testIgnore: /username-accounts|entitlements|learn-admin|companion-admin/,
          grep: /mobile/,
        },
        // The public sign-in as staging runs it: Google, open to everyone, and
        // username accounts for invited testers (the second test server,
        // scripts/e2e-server.ts).
        {
          name: "google-only",
          use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:8081" },
          testMatch: /(google-only|username-accounts)\.spec\.ts/,
        },
        {
          name: "google-only-iphone",
          use: { ...devices["iPhone 13"], baseURL: "http://localhost:8081" },
          testMatch: /(google-only|username-accounts)\.spec\.ts/,
          grep: /mobile/,
        },
        // What plans may use, enforced: the third test server, set up like
        // staging with its published plan catalog. Its tests publish other
        // catalogs, so they run one at a time, the iPhone ones after the rest.
        {
          name: "entitlements",
          use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:8082" },
          testMatch: /entitlements\.spec\.ts/,
          grepInvert: /mobile/,
          fullyParallel: false,
        },
        {
          name: "entitlements-iphone",
          use: { ...devices["iPhone 13"], baseURL: "http://localhost:8082" },
          testMatch: /entitlements\.spec\.ts/,
          grep: /mobile/,
          fullyParallel: false,
          dependencies: ["entitlements"],
        },
        // Admin → Learn's editor (ADR-0023) on the same server, once the
        // plan-enforcement tests are done: it changes the published Learn
        // content, so it runs after them, one test at a time.
        {
          name: "learn-admin",
          use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:8082" },
          testMatch: /learn-admin\.spec\.ts/,
          grepInvert: /mobile/,
          fullyParallel: false,
          dependencies: ["entitlements-iphone"],
        },
        {
          name: "learn-admin-iphone",
          use: { ...devices["iPhone 13"], baseURL: "http://localhost:8082" },
          testMatch: /learn-admin\.spec\.ts/,
          grep: /mobile/,
          fullyParallel: false,
          dependencies: ["learn-admin"],
        },
        // Admin → Companion (ADR-0024) on the same server, last: it changes
        // Sketchy's live configuration (switches him off and on, adds tips).
        {
          name: "companion-admin",
          use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:8082" },
          testMatch: /companion-admin\.spec\.ts/,
          fullyParallel: false,
          dependencies: ["learn-admin-iphone"],
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
