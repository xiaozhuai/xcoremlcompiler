import { defineConfig } from "tsdown";

export default defineConfig([
  {
    name: "core",
    entry: { xcoremlcompiler: "src/index.ts" },
    format: ["cjs", "esm"],
    platform: "neutral",
    inputOptions: { resolve: { mainFields: ["module", "main"] } },
    outExtensions: ({ format }) => ({
      js: format === "cjs" ? ".cjs" : ".mjs",
      dts: format === "cjs" ? ".d.cts" : ".d.mts",
    }),
    minify: true,
    outputOptions: { codeSplitting: false },
    dts: true,
    sourcemap: true,
    clean: true,
    target: false,
    deps: { alwaysBundle: [/.*/] },
  },
  {
    name: "cli",
    entry: {
      index: "src/cli.ts",
      filesystem: "src/cli/filesystem.ts",
    },
    outDir: "dist/cli",
    format: "esm",
    platform: "node",
    dts: false,
    sourcemap: true,
    clean: true,
    target: false,
    deps: { alwaysBundle: [/.*/] },
  },
]);
