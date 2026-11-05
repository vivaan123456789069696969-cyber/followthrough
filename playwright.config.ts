import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: { baseURL, trace: "on-first-retry" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"], viewport: { width: 360, height: 740 } } },
  ],
  webServer: [
    {
      command: "node tests/e2e/fake-supabase.mjs",
      url: "http://127.0.0.1:54399/health",
      reuseExistingServer: false,
    },
    {
      // A production build, so this also works while `npm run dev` holds the dev lock.
      command: `npm run build && npm run start -- --port ${port}`,
      url: baseURL,
      reuseExistingServer: false,
      env: {
        NEXT_PUBLIC_APP_URL: baseURL,
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54399",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_e2e_placeholder",
      },
      timeout: 240_000,
    },
  ],
});
