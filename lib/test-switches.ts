/**
 * Test-only switches (a simulated clock, stand-in servers) work only off Vercel's
 * production deployment, so a stray setting there can never fake time or send secrets
 * elsewhere. Browser tests run a production build locally, where VERCEL_ENV is unset.
 */
export function testSwitch(name: string): boolean {
  return process.env.VERCEL_ENV !== "production" && process.env[name] === "true";
}
