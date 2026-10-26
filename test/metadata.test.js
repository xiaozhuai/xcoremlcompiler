import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { writeFixture, fingerprint } from "../tools/conformance.mjs";
import { compileDirectory } from "../dist/cli/filesystem.mjs";
import { metadataPackage } from "xcoremlcompiler";
const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../dist/cli/index.mjs", import.meta.url));
const corpus = JSON.parse(
  await fs.readFile(
    process.env.XCOREML_CONFORMANCE_FILE ||
      new URL("../testdata/corpus.json", import.meta.url),
    "utf8",
  ),
);
test("metadataPackage returns an independent metadata object", () => {
  const c = corpus.cases[0];
  const input = new Map(
    Object.entries(c.input).map(([name, encoded]) => [
      name,
      new Uint8Array(Buffer.from(encoded, "base64")),
    ]),
  );
  const result = metadataPackage(input, { modelName: c.name });
  assert.equal(typeof result, "object");
  assert.equal(Array.isArray(result), false);
  assert.deepEqual(result, c.metadata[0]);
  result.inputSchema[0].name = "changed";
  result.userDefinedMetadata.changed = "yes";
  assert.deepEqual(
    metadataPackage(input, { modelName: c.name }),
    c.metadata[0],
  );
});
for (const c of [
  ...[
    "unary_identity_11",
    "external_fp32",
    "unicode_metadata",
    "options_metadata_overlay_no",
    "options_spec10_binary_add_11_true_yes",
  ].map((name) => corpus.cases.find((c) => c.name === name)),
  corpus.encrypted_cases[0],
  ...corpus.metadata_cases,
])
  test(`metadata CLI: Apple conformance for ${c.name}`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcoreml-metadata-"));
    try {
      const input = await writeFixture(root, c),
        before = await fingerprint(input);
      const result = await exec(process.execPath, [cli, "metadata", input]);
      assert.equal(result.stderr, "");
      assert.deepEqual(JSON.parse(result.stdout), c.metadata);
      assert.deepEqual(await fingerprint(input), before);
      assert.deepEqual(await fs.readdir(root), [path.basename(input)]);
      if (c.name === "metadata_nonfinite_constant")
        await assert.rejects(
          compileDirectory(input, path.join(root, "compiled")),
          /Non-finite/,
        );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

test("metadata CLI rejects Espresso, malformed models, invalid packages and symlinks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcoreml-metadata-"));
  try {
    const input = await writeFixture(root, corpus.cases[0]);
    const model = path.join(input, "Data/com.apple.CoreML/model.mlmodel");
    for (const [data, pattern] of [
      [Buffer.from([8, 6, 0xa2, 0x1f, 0]), /Espresso\/NeuralNetwork/],
      [Buffer.from([255]), /protobuf|varint/i],
    ]) {
      await fs.writeFile(model, data);
      await assert.rejects(
        exec(process.execPath, [cli, "metadata", input]),
        (error) => {
          assert.equal(error.code, 1);
          assert.equal(error.stdout, "");
          assert.match(error.stderr, pattern);
          return true;
        },
      );
    }
    const raw = path.join(root, "model.mlmodel");
    await fs.writeFile(raw, Buffer.from([8, 6]));
    await assert.rejects(
      exec(process.execPath, [cli, "metadata", raw]),
      /Only MIL\/ML Program .mlpackage/,
    );
    const weighted = await writeFixture(
      root,
      corpus.cases.find((c) => c.name === "external_fp32"),
    );
    await fs.writeFile(
      path.join(weighted, "Data/com.apple.CoreML/weights/weight.bin"),
      Buffer.from([0]),
    );
    await assert.rejects(
      exec(process.execPath, [cli, "metadata", weighted]),
      /Weight blob/,
    );
    await assert.rejects(exec(process.execPath, [cli, "metadata"]));
    await assert.rejects(
      exec(process.execPath, [
        cli,
        "metadata",
        input,
        "--output",
        path.join(root, "unexpected"),
      ]),
    );
    await fs.rm(model);
    await fs.symlink(root, path.join(input, "external"), "junction");
    await assert.rejects(
      exec(process.execPath, [cli, "metadata", input]),
      /symlinks/,
    );
    assert.equal(
      (await fs.readdir(root)).some((name) =>
        name.startsWith(".xcoremlcompiler-"),
      ),
      false,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
