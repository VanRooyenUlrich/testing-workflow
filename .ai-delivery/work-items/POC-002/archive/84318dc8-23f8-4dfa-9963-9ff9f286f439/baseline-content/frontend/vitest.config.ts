import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: ".vite",
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
  },
});
