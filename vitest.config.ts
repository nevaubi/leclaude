import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    env: { // VITEST_DATA_DIR lets concurrent runs (parallel workers) use separate databases.
    LECLAUDE_DATA_DIR: process.env.VITEST_DATA_DIR || path.resolve(".vitest-data"), LECLAUDE_SEED: "demo" },
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "tests/server-only-shim.ts") },
  },
});
