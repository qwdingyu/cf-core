import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "features/*/tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/index.ts", "src/db/schema.ts"],
      thresholds: {
        functions: 70,
        branches: 50,
        lines: 60,
      },
    },
  },
});
