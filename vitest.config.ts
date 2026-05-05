import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["node_modules/**", "example/node_modules/**", "lib/**"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
