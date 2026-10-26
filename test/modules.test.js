import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { createRequire } from "node:module";
import * as esm from "xcoremlcompiler";
const require = createRequire(import.meta.url);
const cjs = require("xcoremlcompiler");
const corpus = JSON.parse(
  await fs.readFile(
    process.env.XCOREML_CONFORMANCE_FILE ||
      new URL("../testdata/corpus.json", import.meta.url),
    "utf8",
  ),
);

const portable = vm.createContext({
  exports: {},
  Uint8Array,
  Uint16Array,
  Uint32Array,
  Int32Array,
  ArrayBuffer,
  DataView,
  TextEncoder,
  TextDecoder,
  atob,
  btoa,
});
vm.runInContext(
  await fs.readFile(
    new URL("../dist/xcoremlcompiler.cjs", import.meta.url),
    "utf8",
  ),
  portable,
);
assert.equal(vm.runInContext("typeof require", portable), "undefined");
assert.equal(vm.runInContext("typeof process", portable), "undefined");
assert.equal(vm.runInContext("typeof Buffer", portable), "undefined");

for (const [format, compiler] of [
  ["ESM", esm],
  ["CJS", cjs],
  ["CJS without Node globals", portable.exports],
])
  test(`${format} package export compiles every independent fixture`, () => {
    assert.equal(typeof compiler.compilePackage, "function");
    assert.equal(typeof compiler.metadataPackage, "function");
    assert.equal(typeof compiler.parseEncryptionKey, "function");
    for (const c of [...corpus.cases, ...corpus.encrypted_cases]) {
      const input = new Map(
        Object.entries(c.input).map(([name, encoded]) => [
          name,
          new Uint8Array(Buffer.from(encoded, "base64")),
        ]),
      );
      const warnings = [];
      assert.deepEqual(
        JSON.parse(
          JSON.stringify(
            compiler.metadataPackage(input, { modelName: c.name }),
          ),
        ),
        c.metadata,
        c.name,
      );
      const result = compiler.compilePackage(input, {
        ...c.options,
        onWarning: (warning) => warnings.push(warning.message),
        modelName: c.name,
        encryptionKey: c.key
          ? compiler.parseEncryptionKey(Buffer.from(c.key, "base64"))
          : undefined,
      });
      assert.deepEqual(warnings, c.warnings ?? [], c.name);
      assert.deepEqual(
        [...result.keys()].sort(),
        Object.keys(c.expected).sort(),
        c.name,
      );
      for (const [name, encoded] of Object.entries(c.expected)) {
        const actual = Buffer.from(result.get(name)),
          expected = Buffer.from(encoded, "base64");
        if (actual.equals(expected)) continue;
        if (name === "coremldata.bin") {
          assert.deepEqual(
            Buffer.from(compiler.canonicalContainer(actual)),
            Buffer.from(compiler.canonicalContainer(expected)),
            c.name,
          );
          continue;
        }
        if (name.endsWith(".json")) {
          assert.deepEqual(JSON.parse(actual), JSON.parse(expected), c.name);
          continue;
        }
        assert.deepEqual(actual, expected, c.name + ": " + name);
      }
    }
    for (const c of corpus.metadata_cases) {
      const input = new Map(
        Object.entries(c.input).map(([name, encoded]) => [
          name,
          new Uint8Array(Buffer.from(encoded, "base64")),
        ]),
      );
      assert.deepEqual(
        JSON.parse(
          JSON.stringify(
            compiler.metadataPackage(input, { modelName: c.name }),
          ),
        ),
        c.metadata,
        c.name,
      );
    }
  });
