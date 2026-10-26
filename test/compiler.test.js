import {
  compileDirectory as compile,
  readEncryptionKey,
  metadataDirectory,
} from "../dist/cli/filesystem.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { canonicalContainer } from "xcoremlcompiler";
const corpus = JSON.parse(
  await fs.readFile(
    process.env.XCOREML_CONFORMANCE_FILE ||
      new URL("../testdata/corpus.json", import.meta.url),
    "utf8",
  ),
);
async function writeFixture(root, c) {
  const p = path.join(root, "source", c.name + ".mlpackage");
  for (const [name, data] of Object.entries(c.input)) {
    const f = path.join(p, name);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, Buffer.from(data, "base64"));
  }
  return p;
}
for (const c of [...corpus.cases, ...corpus.encrypted_cases])
  test(`Apple conformance: ${c.name}`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcoreml-js-"));
    try {
      const input = await writeFixture(root, c);
      assert.deepEqual(await metadataDirectory(input), c.metadata[0]);
      const encryptionKeyPath = c.key
        ? path.join(root, "synthetic.mlmodelkey")
        : undefined;
      if (encryptionKeyPath)
        await fs.writeFile(encryptionKeyPath, Buffer.from(c.key, "base64"), {
          mode: 0o600,
        });
      const warnings = [];
      const output = await compile(input, path.join(root, "out"), {
        ...c.options,
        onWarning: (warning) => warnings.push(warning.message),
        encryptionKeyPath,
      });
      assert.deepEqual(warnings, c.warnings ?? []);
      const walk = async (p) => {
        const r = [];
        for (const e of await fs.readdir(p, { withFileTypes: true })) {
          const f = path.join(p, e.name);
          if (e.isDirectory()) r.push(...(await walk(f)));
          else r.push(path.relative(output, f).split(path.sep).join("/"));
        }
        return r;
      };
      assert.deepEqual(
        (await walk(output)).sort(),
        Object.keys(c.expected).sort(),
      );
      for (const [name, encoded] of Object.entries(c.expected)) {
        const expected = Buffer.from(encoded, "base64"),
          actual = await fs.readFile(path.join(output, name));
        if (actual.equals(expected)) continue;
        if (name === "coremldata.bin") {
          assert.deepEqual(
            canonicalContainer(actual),
            canonicalContainer(expected),
            name,
          );
          continue;
        }
        if (name.endsWith(".json")) {
          assert.deepEqual(JSON.parse(actual), JSON.parse(expected), name);
          continue;
        }
        assert.deepEqual(Buffer.from(actual), expected, name);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
test("source isolation and existing outputs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcoreml-js-"));
  try {
    const c = corpus.cases[0],
      input = await writeFixture(root, c);
    await assert.rejects(
      compile(input, path.join(input, "out")),
      /outside source/,
    );
    await compile(input, path.join(root, "out"));
    await assert.rejects(
      compile(input, path.join(root, "out")),
      /already exists/,
    );
    for (const [name, data] of Object.entries(c.input))
      assert.deepEqual(
        await fs.readFile(path.join(input, name)),
        Buffer.from(data, "base64"),
      );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("malformed protobuf leaves no partial output", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcoreml-js-"));
  try {
    const input = await writeFixture(root, corpus.cases[0]);
    await fs.writeFile(
      path.join(input, "Data/com.apple.CoreML/model.mlmodel"),
      Buffer.from([255]),
    );
    await assert.rejects(compile(input, path.join(root, "out")));
    await assert.rejects(fs.stat(path.join(root, "out")), { code: "ENOENT" });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("randomly generated encryption key round trip", async () => {
  const { randomBytes, randomUUID } = await import("node:crypto");
  const { build } = await import("plist");
  const { decryptForVerification } = await import("xcoremlcompiler");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcoreml-encryption-"));
  try {
    const c = corpus.cases.find((c) => c.name === "external_fp32");
    const input = await writeFixture(root, c),
      keyPath = path.join(root, "random.mlmodelkey");
    await fs.writeFile(
      keyPath,
      build({
        Key: randomBytes(16),
        IV: randomBytes(16),
        KeyIdentifier: randomUUID(),
        Version: 1,
        UsesCodeSigningIdentityForEncryption: false,
      }),
      { mode: 0o600 },
    );
    const key = await readEncryptionKey(keyPath),
      output = await compile(input, path.join(root, "out"), {
        encryptionKeyPath: keyPath,
      });
    for (const [name, encoded] of Object.entries(c.expected)) {
      if (name === "metadata.json") continue;
      const actual = decryptForVerification(
          await fs.readFile(path.join(output, name)),
          key,
        ),
        expected = Buffer.from(encoded, "base64");
      if (name === "coremldata.bin")
        assert.deepEqual(
          canonicalContainer(actual),
          canonicalContainer(expected),
        );
      else assert.deepEqual(Buffer.from(actual), expected, name);
    }
    await fs.writeFile(
      keyPath,
      build({ Key: randomBytes(16), KeyIdentifier: randomUUID(), Version: 1 }),
    );
    await assert.rejects(readEncryptionKey(keyPath), /Unsupported/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("exact output path, arbitrary suffix and CLI --output", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcoreml-cli-"));
  try {
    const input = await writeFixture(root, corpus.cases[0]);
    const output = path.join(root, "nested", "arbitrary-output-name");
    const cli = new URL("../dist/cli/index.mjs", import.meta.url);
    const { fileURLToPath } = await import("node:url");
    await promisify(execFile)(process.execPath, [
      fileURLToPath(cli),
      "compile",
      input,
      "--output",
      output,
    ]);
    assert.ok((await fs.stat(path.join(output, "model.mil"))).isFile());
    assert.equal(
      await compile(input, path.join(root, "output.custom")),
      await fs.realpath(path.join(root, "output.custom")),
    );
    await assert.rejects(
      promisify(execFile)(process.execPath, [
        fileURLToPath(cli),
        "compile",
        input,
        path.join(root, "old-positional-style"),
      ]),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("explicitly rejects Espresso and non-package inputs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcoreml-legacy-"));
  try {
    const input = await writeFixture(root, corpus.cases[0]);
    await fs.writeFile(
      path.join(input, "Data/com.apple.CoreML/model.mlmodel"),
      Buffer.from([8, 6, 0xa2, 0x1f, 0]),
    );
    await assert.rejects(
      compile(input, path.join(root, "legacy-output")),
      /Espresso\/NeuralNetwork/,
    );
    const raw = path.join(root, "standalone.mlmodel");
    await fs.writeFile(raw, Buffer.from([8, 6]));
    await assert.rejects(
      compile(raw, path.join(root, "raw-output")),
      /Only MIL\/ML Program .mlpackage/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("output aliases resolve to the requested directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcoreml-alias-"));
  try {
    const real = path.join(root, "real");
    await fs.mkdir(real);
    const input = await writeFixture(real, corpus.cases[0]);
    const alias = path.join(root, "alias");
    await fs.symlink(real, alias, "junction");
    const requested = path.join(alias, "output-without-extension");
    const actual = await compile(input, requested);
    assert.equal(actual, await fs.realpath(requested));
    assert.ok((await fs.stat(path.join(requested, "model.mil"))).isFile());
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
