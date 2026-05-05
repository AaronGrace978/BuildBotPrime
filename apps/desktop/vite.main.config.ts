import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@buildbotprime/core": resolve(__dirname, "../../packages/core/src/index.ts"),
      "@buildbotprime/ide-adapters": resolve(__dirname, "../../packages/ide-adapters/src/index.ts"),
      "@buildbotprime/model-providers": resolve(__dirname, "../../packages/model-providers/src/index.ts"),
      "@buildbotprime/observer": resolve(__dirname, "../../packages/observer/src/index.ts"),
      "@buildbotprime/product-knowledge": resolve(__dirname, "../../packages/product-knowledge/src/index.ts"),
      "@buildbotprime/project-runner": resolve(__dirname, "../../packages/project-runner/src/index.ts"),
      "@buildbotprime/secure-storage": resolve(__dirname, "../../packages/secure-storage/src/index.ts"),
      "@buildbotprime/storage": resolve(__dirname, "../../packages/storage/src/index.ts"),
      "@buildbotprime/twin-mind": resolve(__dirname, "../../packages/twin-mind/src/index.ts")
    }
  },
  build: {
    emptyOutDir: true,
    lib: {
      entry: {
        main: resolve(__dirname, "src/main/main.ts"),
        preload: resolve(__dirname, "src/main/preload.ts")
      },
      formats: ["cjs"]
    },
    minify: false,
    outDir: resolve(__dirname, "dist/main"),
    sourcemap: true,
    target: "node22",
    rollupOptions: {
      external: [
        "@cursor/sdk",
        "electron",
        "node:child_process",
        "node:fs",
        "node:fs/promises",
        "node:path"
      ],
      output: {
        entryFileNames: "[name].cjs",
        chunkFileNames: "[name]-[hash].cjs"
      }
    }
  }
});
