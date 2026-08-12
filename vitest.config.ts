import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      enabled: false,
      provider: "v8",
      reporter: ["text", "json-summary"],
    },
    environment: "node",
    include: ["packages/**/test/**/*.test.ts", "apps/**/test/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
