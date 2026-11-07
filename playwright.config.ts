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
        NEXT_PUBLIC_GOOGLE_SIGN_IN: "true",
        // The fake server also stands in for the Claude API, so no real key or cost.
        ANTHROPIC_API_KEY: "sk-ant-e2e-placeholder",
        ANTHROPIC_BASE_URL: "http://127.0.0.1:54399",
        ANTHROPIC_MODEL: "claude-opus-5-5",
        // Google and the server's admin access, both answered by the fake server.
        SUPABASE_SECRET_KEY: "sb_secret_e2e_placeholder",
        GOOGLE_CLIENT_ID: "e2e-client",
        GOOGLE_CLIENT_SECRET: "e2e-secret",
        GOOGLE_REDIRECT_URI: `${baseURL}/api/google/callback`,
        GOOGLE_TEST_ENDPOINTS: "true",
        GOOGLE_AUTH_URL: "http://127.0.0.1:54399/google/authorize",
        GOOGLE_TOKEN_URL: "http://127.0.0.1:54399/google/token",
        GOOGLE_REVOKE_URL: "http://127.0.0.1:54399/google/revoke",
        GOOGLE_API_URL: "http://127.0.0.1:54399/google/api",
        // A fixed test key, used only by the fake server's data.
        TOKEN_ENC_KEY: "ZTJlLW9ubHktdGVzdC1rZXktMzItYnl0ZXMtbG9uZyE=",
        CRON_SECRET: "e2e-cron-secret-at-least-32-characters-long",
      },
      timeout: 240_000,
    },
  ],
});
