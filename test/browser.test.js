import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { DOMParser } from "@xmldom/xmldom";
import { canonicalContainer } from "xcoremlcompiler";

test("portable core: every synthetic case without Node globals", async () => {
  const corpus = JSON.parse(
    await fs.readFile(
      process.env.XCOREML_CONFORMANCE_FILE ||
        new URL("../testdata/corpus.json", import.meta.url),
      "utf8",
    ),
  );
  const source = await fs.readFile(
    new URL("../dist/browser/index.iife.js", import.meta.url),
    "utf8",
  );
  const context = vm.createContext({
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
    DOMParser,
  });
  vm.runInContext(source, context);
  assert.equal(vm.runInContext("typeof process", context), "undefined");
  assert.equal(vm.runInContext("typeof Buffer", context), "undefined");
  assert.equal(vm.runInContext("typeof require", context), "undefined");
  const core = context.XCoreMLCompiler;
  for (const c of [...corpus.cases, ...corpus.encrypted_cases]) {
    const inputs = new Map(
      Object.entries(c.input).map(([name, data]) => [
        name,
        new Uint8Array(Buffer.from(data, "base64")),
      ]),
    );
    const warnings = [];
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(core.metadataPackage(inputs, { modelName: c.name })),
      ),
      c.metadata,
      c.name,
    );
    const result = core.compilePackage(inputs, {
      ...c.options,
      onWarning: (warning) => warnings.push(warning.message),
      modelName: c.name,
      encryptionKey: c.key
        ? core.parseEncryptionKey(new Uint8Array(Buffer.from(c.key, "base64")))
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
          Buffer.from(canonicalContainer(actual)),
          Buffer.from(canonicalContainer(expected)),
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
    const inputs = new Map(
      Object.entries(c.input).map(([name, encoded]) => [
        name,
        new Uint8Array(Buffer.from(encoded, "base64")),
      ]),
    );
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(core.metadataPackage(inputs, { modelName: c.name })),
      ),
      c.metadata,
      c.name,
    );
  }
});
