import {
  compileDirectory as compile,
  readEncryptionKey,
} from "../dist/cli/filesystem.mjs";
// Local differential validation. External models and keys stay in the explicitly
// chosen work directory and are never incorporated into the committed corpus.
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs, promisify, isDeepStrictEqual } from "node:util";
import { execFile } from "node:child_process";
import { referenceVersion } from "xcoremlcompiler";
import { compare, writeFixture, fingerprint, inside } from "./conformance.mjs";
const { values } = parseArgs({
  options: {
    reference: { type: "string" },
    models: { type: "string" },
    work: { type: "string" },
    key: { type: "string" },
    synthetic: { type: "boolean", default: false },
  },
});
if (!values.reference || !values.work || (!values.models && !values.synthetic))
  throw new Error(
    "usage: node tools/verify.mjs --reference COREMLCOMPILER --work NEW_DIRECTORY [--models READ_ONLY_DIRECTORY] [--synthetic] [--key KEY.mlmodelkey]",
  );
const reference = path.resolve(values.reference),
  root = path.resolve(values.work),
  models = values.models ? await fs.realpath(values.models) : undefined;
if (models && inside(models, root))
  throw new Error("Work directory must be outside model source");
await fs.mkdir(root);
const before = models ? await fingerprint(models) : undefined;
const sharedKey = values.key ? await readEncryptionKey(values.key) : undefined;
const sources = [];
if (values.synthetic) {
  const corpus = JSON.parse(
    await fs.readFile(
      new URL("../testdata/corpus.json", import.meta.url),
      "utf8",
    ),
  );
  for (const c of [...corpus.cases, ...corpus.encrypted_cases]) {
    const input = await writeFixture(path.join(root, "synthetic"), c);
    let keyPath = values.key;
    if (c.key && !keyPath) {
      keyPath = path.join(root, c.name + ".mlmodelkey");
      await fs.writeFile(keyPath, Buffer.from(c.key, "base64"), {
        mode: 0o600,
      });
    }
    sources.push({ input, synthetic: true, keyPath, options: c.options });
  }
}
if (models) {
  async function visit(p) {
    for (const entry of await fs.readdir(p, { withFileTypes: true })) {
      if (entry.isSymbolicLink())
        throw new Error("Model tree symlinks are not supported");
      if (!entry.isDirectory()) continue;
      const f = path.join(p, entry.name);
      if (entry.name.endsWith(".mlpackage"))
        sources.push({ input: f, synthetic: false, keyPath: values.key });
      else await visit(f);
    }
  }
  await visit(models);
}
const exec = promisify(execFile),
  report = {
    format: referenceVersion,
    cases: [],
    source_unchanged: true,
    byte_equal_files: 0,
    order_only_files: 0,
    unexpected_files: 0,
    failed_cases: 0,
  };
for (const [i, item] of sources.entries()) {
  const parent = path.join(root, `case-${String(i).padStart(4, "0")}`),
    nativeParent = path.join(parent, "reference");
  const r = {
    input: item.input,
    synthetic: item.synthetic,
    encrypted: !!item.keyPath,
    reference: path.join(
      nativeParent,
      path.basename(item.input, path.extname(item.input)) + ".mlmodelc",
    ),
    output: path.join(parent, "portable-output"),
    files: [],
  };
  try {
    const args = ["compile", item.input, nativeParent];
    if (item.options?.packageMetadataJSON !== undefined)
      args.push(
        "--package-metadata-json",
        item.options.packageMetadataJSON ? "YES" : "NO",
      );
    if (item.options?.platform) args.push("--platform", item.options.platform);
    if (item.options?.deploymentTarget)
      args.push("--deployment-target", item.options.deploymentTarget);
    if (item.keyPath) args.push("--encrypt", path.resolve(item.keyPath));
    await exec(reference, args, { env: { ...process.env, TMPDIR: root } });
    await compile(item.input, r.output, {
      ...item.options,
      encryptionKeyPath: item.keyPath,
    });
    const key = item.keyPath
      ? (sharedKey ?? (await readEncryptionKey(item.keyPath)))
      : undefined;
    r.files = await compare(r.reference, r.output, key);
    for (const f of r.files) {
      if (f.byte_equal) report.byte_equal_files++;
      else if (f.order_only) report.order_only_files++;
      else {
        report.unexpected_files++;
        console.log("DIFF", path.basename(item.input), f.path);
      }
    }
  } catch (error) {
    r.error = error.message;
    report.failed_cases++;
    console.log("FAIL", path.basename(item.input), error.message);
  }
  report.cases.push(r);
}
if (models) {
  const after = await fingerprint(models);
  report.source_unchanged = isDeepStrictEqual(before, after);
  await fs.writeFile(
    path.join(root, "source-before.json"),
    JSON.stringify(before),
  );
  await fs.writeFile(
    path.join(root, "source-after.json"),
    JSON.stringify(after),
  );
}
await fs.writeFile(
  path.join(root, "report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  `Cases: ${report.cases.length}; failed: ${report.failed_cases}; byte-equal files: ${report.byte_equal_files}; ordering-only differences: ${report.order_only_files}; unexpected differences: ${report.unexpected_files}; sources unchanged: ${report.source_unchanged}`,
);
if (report.failed_cases || report.unexpected_files || !report.source_unchanged)
  process.exitCode = 1;
