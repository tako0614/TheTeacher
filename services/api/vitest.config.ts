import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude],
    coverage: {
      reporter: ["text", "lcov"],
    },
  },
});
