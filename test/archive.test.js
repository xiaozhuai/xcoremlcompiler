import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import {
  canonicalContainer,
  parseEncryptionKey,
  decryptForVerification,
} from "xcoremlcompiler";
import { writeFixture, fingerprint } from "../tools/conformance.mjs";
const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../dist/cli/index.mjs", import.meta.url));
const corpus = JSON.parse(
  await fs.readFile(
    process.env.XCOREML_CONFORMANCE_FILE ||
      new URL("../testdata/corpus.json", import.meta.url),
    "utf8",
  ),
);
for (const archive of corpus.archive_cases)
  test(`Apple archive conformance: ${archive.fixture}`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcoreml-archive-"));
    try {
      const c = [...corpus.cases, ...corpus.encrypted_cases].find(
        (c) => c.name === archive.fixture,
      );
      const input = await writeFixture(root, c),
        before = await fingerprint(input);
      const output = path.join(root, "nested", "Example.mlarchive");
      const args = [
        cli,
        "compile",
        input,
        "--output",
        output,
        "--create-archive",
      ];
      if (c.options?.packageMetadataJSON !== undefined)
        args.push(
          "--package-metadata-json",
          c.options.packageMetadataJSON ? "YES" : "NO",
        );
      if (c.options?.platform) args.push("--platform", c.options.platform);
      if (c.options?.deploymentTarget)
        args.push("--deployment-target", c.options.deploymentTarget);
      let key;
      if (c.key) {
        const keyPath = path.join(root, "synthetic.mlmodelkey");
        await fs.writeFile(keyPath, Buffer.from(c.key, "base64"), {
          mode: 0o600,
        });
        key = parseEncryptionKey(Buffer.from(c.key, "base64"));
        args.push("--encrypt", keyPath);
      }
      const result = await exec(process.execPath, args);
      assert.equal(result.stdout.trim(), await fs.realpath(output));
      assert.ok((await fs.stat(output)).isFile());
      const zip = await JSZip.loadAsync(await fs.readFile(output), {
        checkCRC32: true,
      });
      const names = Object.values(zip.files)
        .filter((e) => !e.dir)
        .map((e) => e.name)
        .sort();
      assert.deepEqual(names, Object.keys(archive.expected).sort());
      for (const [name, encoded] of Object.entries(archive.expected)) {
        const actual = await zip.file(name).async("nodebuffer"),
          expected = Buffer.from(encoded, "base64");
        if (actual.equals(expected)) continue;
        if (name.endsWith(".json"))
          assert.deepEqual(JSON.parse(actual), JSON.parse(expected), name);
        else if (name === "coremldata.bin") {
          assert.deepEqual(
            Buffer.from(
              canonicalContainer(
                key ? decryptForVerification(actual, key) : actual,
              ),
            ),
            Buffer.from(
              canonicalContainer(
                key ? decryptForVerification(expected, key) : expected,
              ),
            ),
            name,
          );
        } else assert.deepEqual(actual, expected, name);
      }
      assert.deepEqual(await fingerprint(input), before);
      assert.deepEqual(await fs.readdir(path.dirname(output)), [
        path.basename(output),
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

test("archive exact path, source isolation, existing output and failed compilation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcoreml-archive-"));
  try {
    const c = corpus.cases[0],
      input = await writeFixture(root, c),
      before = await fingerprint(input);
    const output = path.join(root, "custom-suffix");
    const args = [cli, "compile", input, "--create-archive", "--output"];
    await exec(process.execPath, [...args, output]);
    const original = await fs.readFile(output);
    assert.ok((await fs.stat(output)).isFile());
    await assert.rejects(
      exec(process.execPath, [...args, output]),
      /Output already exists/,
    );
    assert.deepEqual(await fs.readFile(output), original);
    await assert.rejects(
      exec(process.execPath, [...args, path.join(input, "output.mlarchive")]),
      /outside source/,
    );
    assert.deepEqual(await fingerprint(input), before);
    await fs.writeFile(
      path.join(input, "Data/com.apple.CoreML/model.mlmodel"),
      Buffer.from([255]),
    );
    const failed = path.join(root, "failed.mlarchive");
    await assert.rejects(exec(process.execPath, [...args, failed]));
    await assert.rejects(fs.stat(failed), { code: "ENOENT" });
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

test("ESM and CJS library bundles exclude CLI dependencies", async () => {
  for (const extension of ["mjs", "cjs"]) {
    const map = JSON.parse(
      await fs.readFile(
        new URL(`../dist/xcoremlcompiler.${extension}.map`, import.meta.url),
        "utf8",
      ),
    );
    assert.equal(
      map.sources.some((name) =>
        /\/(jszip|yargs|yargs-parser|y18n|cliui|pako)\//.test(
          name.replaceAll("\\", "/"),
        ),
      ),
      false,
    );
  }
});
