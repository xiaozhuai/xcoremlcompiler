// Only self-constructed input templates are used. Every generated key is random
// synthetic test material, never a user's real key or Apple-registered identity.
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs, promisify } from "node:util";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { parse, build, buildBinary } from "plist";
import { files, writeFixture } from "./conformance.mjs";
const exec = promisify(execFile);
const { values } = parseArgs({
  options: { reference: { type: "string" }, output: { type: "string" } },
});
if (!values.reference || !values.output)
  throw new Error(
    "usage: node tools/prepare-conformance.mjs --reference COREMLCOMPILER --output NEW_DIRECTORY",
  );
const reference = path.resolve(values.reference),
  root = path.resolve(values.output);
await fs.mkdir(root);
const version = (await exec(reference, ["version"])).stdout.trim();
if (version !== "3500.32.1")
  throw new Error(
    `Reference version ${version} is unsupported; expected 3500.32.1`,
  );
const source = JSON.parse(
  await fs.readFile(
    new URL("../testdata/corpus.json", import.meta.url),
    "utf8",
  ),
);
function freshWeights(data) {
  const result = Buffer.from(data);
  if (result.length < 64 || result.readUInt32LE(4) !== 2)
    throw new Error("Unsupported synthetic blob format");
  let offset = 64;
  for (let i = 0; i < result.readUInt32LE(); i++) {
    if (
      offset + 64 > result.length ||
      result.readUInt32LE(offset) !== 0xdeadbeef
    )
      throw new Error("Malformed synthetic blob");
    const type = result.readUInt32LE(offset + 4),
      size = Number(result.readBigUInt64LE(offset + 8)),
      start = Number(result.readBigUInt64LE(offset + 16));
    if (start + size > result.length)
      throw new Error("Malformed synthetic blob size");
    const entropy = randomBytes(size);
    if (type === 1) {
      const samples = [0, 0x2800, 0x2c00, 0x3000, 0x3400, 0xb000];
      for (let n = 0; n < size; n += 2)
        result.writeUInt16LE(samples[entropy[n] % samples.length], start + n);
    } else if (type === 2) {
      for (let n = 0; n < size; n += 4)
        result.writeFloatLE((entropy[n] - 128) / 512, start + n);
    } else throw new Error("Unsupported synthetic weight type");
    offset = Math.ceil((start + size) / 64) * 64;
  }
  return result;
}
const output = {
  format: version,
  origin:
    "Independently constructed input templates with freshly generated synthetic weights and keys; Apple reference outputs.",
  cases: [],
  encrypted_cases: [],
  archive_cases: [],
  metadata_cases: [],
};
for (const [field, cases] of [
  ["cases", source.cases],
  ["encrypted_cases", source.encrypted_cases],
])
  for (const original of cases) {
    const c = structuredClone(original);
    for (const [name, encoded] of Object.entries(c.input))
      if (name.endsWith("/weights/weight.bin"))
        c.input[name] = freshWeights(Buffer.from(encoded, "base64")).toString(
          "base64",
        );
    const input = await writeFixture(path.join(root, "inputs"), c);
    c.metadata = JSON.parse(
      (await exec(reference, ["metadata", input])).stdout,
    );
    let keyPath;
    if (c.key) {
      const oldBytes = Buffer.from(c.key, "base64"),
        old = parse(
          oldBytes.subarray(0, 8).toString() === "bplist00"
            ? oldBytes
            : oldBytes.toString(),
        );
      const key = {
        Version: 1,
        Key: randomBytes(16),
        IV: randomBytes(16),
        KeyIdentifier: randomUUID(),
        UsesCodeSigningIdentityForEncryption:
          old.UsesCodeSigningIdentityForEncryption,
      };
      const data =
        oldBytes.subarray(0, 8).toString() === "bplist00"
          ? Buffer.from(buildBinary(key))
          : Buffer.from(build(key));
      c.key = data.toString("base64");
      keyPath = path.join(root, c.name + ".mlmodelkey");
      await fs.writeFile(keyPath, data, { mode: 0o600 });
    }
    const parent = path.join(root, "reference", c.name);
    const args = ["compile", input, parent];
    if (c.options?.packageMetadataJSON !== undefined)
      args.push(
        "--package-metadata-json",
        c.options.packageMetadataJSON ? "YES" : "NO",
      );
    if (c.options?.platform !== undefined)
      args.push("--platform", c.options.platform);
    if (c.options?.deploymentTarget !== undefined)
      args.push("--deployment-target", c.options.deploymentTarget);
    if (keyPath) args.push("--encrypt", keyPath);
    const native = await exec(reference, args);
    c.warnings = native.stderr
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const prefix = "coremlcompiler: warning: compile command ";
        if (!line.startsWith(prefix))
          throw new Error(`Unexpected native diagnostic: ${line}`);
        return line.slice(prefix.length);
      });
    const expected = await files(path.join(parent, c.name + ".mlmodelc"));
    c.expected = Object.fromEntries(
      Object.entries(expected).map(([k, b]) => [k, b.toString("base64")]),
    );
    if (source.archive_cases?.some((a) => a.fixture === c.name)) {
      const archiveDirectory = path.join(root, "archives", c.name);
      await fs.mkdir(archiveDirectory, { recursive: true });
      await exec(reference, [
        "compile",
        input,
        path.join(root, "archive-build", c.name),
        ...args.slice(3),
        "--create-archive",
        archiveDirectory,
      ]);
      const unpacked = path.join(root, "archive-reference", c.name);
      await fs.mkdir(unpacked, { recursive: true });
      await exec("unzip", [
        "-qq",
        path.join(archiveDirectory, c.name + ".mlarchive"),
        "-d",
        unpacked,
      ]);
      output.archive_cases.push({
        fixture: c.name,
        expected: Object.fromEntries(
          Object.entries(await files(unpacked)).map(([k, b]) => [
            k,
            b.toString("base64"),
          ]),
        ),
      });
    }
    output[field].push(c);
  }
for (const original of source.metadata_cases ?? []) {
  const c = structuredClone(original);
  const input = await writeFixture(path.join(root, "metadata-inputs"), c);
  c.metadata = JSON.parse((await exec(reference, ["metadata", input])).stdout);
  output.metadata_cases.push(c);
}
await fs.writeFile(
  path.join(root, "corpus.json"),
  JSON.stringify(output) + "\n",
);
console.log(
  `Prepared ${output.cases.length} MIL models, ${output.encrypted_cases.length} encrypted cases and ${output.archive_cases.length} archive cases with fresh synthetic data.`,
);
