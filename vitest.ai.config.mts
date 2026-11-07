import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/ai/**/*.ai.test.ts"],
    env: loadEnv("test", process.cwd(), ""),
    testTimeout: 180_000,
    maxConcurrency: 3,
  },
});
