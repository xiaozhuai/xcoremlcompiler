import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { compilePackage } from "xcoremlcompiler";
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
const fixture = corpus.cases.find((c) => c.name === "unary_identity_11");

test("CLI metadata and deployment options preserve compilation and source files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcoreml-options-"));
  try {
    const input = await writeFixture(root, fixture),
      before = await fingerprint(input);
    const output = path.join(root, "Example.mlmodelc");
    const result = await exec(process.execPath, [
      cli,
      "compile",
      input,
      "--output",
      output,
      "--package-metadata-json",
      "NO",
      "--platform",
      "ios",
      "--deployment-target",
      "14.99.99",
    ]);
    assert.match(result.stderr, /warning:.*requires 15\.0 or greater/);
    await assert.rejects(fs.stat(path.join(output, "metadata.json")), {
      code: "ENOENT",
    });
    assert.deepEqual(
      await fs.readFile(path.join(output, "model.mil")),
      Buffer.from(fixture.expected["model.mil"], "base64"),
    );
    const compatible = await exec(process.execPath, [
      cli,
      "compile",
      input,
      "--output",
      path.join(root, "Compatible.mlmodelc"),
      "--package-metadata-json",
      "YES",
      "--platform",
      "iOS",
      "--deployment-target",
      "15.0.1",
    ]);
    assert.equal(compatible.stderr, "");
    assert.ok(
      (
        await fs.stat(path.join(root, "Compatible.mlmodelc", "metadata.json"))
      ).isFile(),
    );
    assert.deepEqual(await fingerprint(input), before);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
for (const [label, options, expected] of [
  ["metadata value", ["--package-metadata-json", "no"], /Invalid values/],
  [
    "platform",
    ["--platform", "windows", "--deployment-target", "10"],
    /Unsupported target platform/,
  ],
  [
    "deployment version",
    ["--platform", "iOS", "--deployment-target", "banana"],
    /must be a version/,
  ],
])
  test(`CLI rejects invalid ${label} without creating output`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcoreml-options-"));
    try {
      const input = await writeFixture(root, fixture),
        output = path.join(root, "Invalid.mlmodelc");
      await assert.rejects(
        exec(process.execPath, [
          cli,
          "compile",
          input,
          "--output",
          output,
          ...options,
        ]),
        (error) => {
          assert.equal(error.code, 1);
          assert.match(error.stderr, expected);
          return true;
        },
      );
      await assert.rejects(fs.stat(output), { code: "ENOENT" });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

test("portable API validates options and reports structured advisory warnings", () => {
  const input = new Map(
    Object.entries(fixture.input).map(([p, b]) => [
      p,
      new Uint8Array(Buffer.from(b, "base64")),
    ]),
  );
  const warnings = [];
  const output = compilePackage(input, {
    platform: "iOS",
    deploymentTarget: "14",
    packageMetadataJSON: false,
    onWarning: (warning) => warnings.push(warning),
  });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, "unsupported-deployment-target");
  assert.equal(output.has("metadata.json"), false);
  assert.ok(output.has("model.mil"));
  assert.doesNotThrow(() =>
    compilePackage(input, { platform: "iOS", deploymentTarget: "14" }),
  );
  assert.throws(
    () => compilePackage(input, { packageMetadataJSON: "NO" }),
    /must be a boolean/,
  );
  assert.throws(
    () => compilePackage(input, { platform: "windows" }),
    /Unsupported target platform/,
  );
  for (const version of ["", "15x", "15.0.0.1", "-1", "9007199254740993"])
    assert.throws(
      () =>
        compilePackage(input, { platform: "iOS", deploymentTarget: version }),
      /version|out of range/,
    );
});
