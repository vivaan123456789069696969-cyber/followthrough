import { expect, test, type Page } from "@playwright/test";
import { dayFromToday, seed, signInFresh, USER_ID } from "./session";

// The plan's target: the dashboard's largest content appears in under 2.5 seconds on a
// mid-range phone. This slows the browser to roughly that: a 4x slower processor and a
// fast mobile connection. The server is local, so this checks what the page itself costs,
// not the network between a person and Vercel.

test.skip(({ isMobile }) => !isMobile, "Measured on the phone profile, the harder case");

async function slowDown(page: Page) {
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await client.send("Network.enable");
  await client.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
}

async function measure(page: Page, path: string) {
  let scriptBytes = 0;
  page.on("response", async (response) => {
    if (response.request().resourceType() === "script") {
      const sizes = await response.request().sizes().catch(() => null);
      scriptBytes += sizes?.responseBodySize ?? 0;
    }
  });
  await page.addInitScript(() => {
    (window as unknown as { __lcp: number }).__lcp = 0;
    new PerformanceObserver((list) => {
      const last = list.getEntries().at(-1);
      if (last) (window as unknown as { __lcp: number }).__lcp = last.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  });
  await page.goto(path, { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
  const lcp = await page.evaluate(() => (window as unknown as { __lcp: number }).__lcp);
  return { lcp, scriptKb: Math.round(scriptBytes / 1024) };
}

test("the dashboard's main content appears within 2.5 seconds on a slow phone", async ({ page, context, baseURL }) => {
  const token = await signInFresh(context, baseURL);
  await seed(
    token,
    "tasks",
    Array.from({ length: 8 }, (_, index) => ({ title: `Task ${index}`, owner_user_id: USER_ID, due_date: dayFromToday(index - 2) })),
  );
  await slowDown(page);
  const { lcp, scriptKb } = await measure(page, "/my-day");
  console.log(`my-day: largest content at ${Math.round(lcp)} ms, ${scriptKb} KB of script`);
  expect(lcp).toBeGreaterThan(0);
  expect(lcp).toBeLessThan(2500);
  // A budget, so the app can't quietly grow heavy. Compressed, as sent.
  expect(scriptKb).toBeLessThan(300);
});

test("the other main screens are as quick", async ({ page, context, baseURL }) => {
  await signInFresh(context, baseURL);
  await slowDown(page);
  for (const path of ["/my-tasks", "/meetings", "/settings", "/sign-in"]) {
    const result = await measure(page, path);
    console.log(`${path}: largest content at ${Math.round(result.lcp)} ms, ${result.scriptKb} KB of script`);
    expect(result.lcp, `${path} largest content`).toBeLessThan(2500);
  }
});
