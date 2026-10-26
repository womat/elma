import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/*/test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    // `pnpm vitest run --coverage`: auch Dateien ohne Test zählen mit, sonst sieht eine ungetestete Datei wie 100 % aus
    coverage: {
      include: ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.ts"],
      reporter: ["text-summary", "text"],
    },
  },
});
