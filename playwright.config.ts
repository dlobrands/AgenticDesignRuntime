import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    browserName: "chromium",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 960 },
  },
});
