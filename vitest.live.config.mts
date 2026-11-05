import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/live/**/*.live.test.ts"],
    env: loadEnv("test", process.cwd(), ""),
    testTimeout: 30_000,
  },
});
