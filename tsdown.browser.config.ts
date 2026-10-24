import { defineConfig } from "tsdown";
export default defineConfig({
  entry: "src/index.ts",
  format: "iife",
  globalName: "XCoreMLCompiler",
  platform: "browser",
  target: "es2022",
  outDir: "dist/browser",
  dts: false,
  clean: true,
  deps: { alwaysBundle: [/.*/] },
});
