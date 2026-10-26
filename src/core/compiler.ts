// The compiler core consumes and returns package-relative byte maps. Filesystem,
// process, networking and other runtime adapters belong exclusively to the CLI.
import { sha256 } from "@noble/hashes/sha2.js";
import { Bytes } from "./bytes.js";
import { Message, u32, u64 } from "./proto.js";
import { programText, referenceVersion } from "./mil.js";
import {
  checkDeploymentTarget,
  type DeploymentOptions,
} from "./compatibility.js";
import {
  metadata,
  metadataObject,
  type PackageMetadata,
  appleJSON,
  canonicalDescription,
  overlayDescription,
} from "./metadata.js";
import {
  encryptBytes,
  encryptionInfo,
  type EncryptionKey,
} from "./encryption.js";
export { referenceVersion };
export interface CompileOptions extends DeploymentOptions {
  modelName?: string;
  encryptionKey?: EncryptionKey;
  /** Include metadata.json (default true). Encryption always omits this file. */
  packageMetadataJSON?: boolean;
}
export type PackageFiles = ReadonlyMap<string, Uint8Array>;
function normalize(name: string): string {
  if (name.startsWith("/") || name.includes("\\") || name.includes(":"))
    throw new Error("Invalid package-relative path");
  const result: string[] = [];
  for (const part of name.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!result.length) throw new Error("Package path escapes source");
      result.pop();
    } else result.push(part);
  }
  return result.join("/");
}
function loadPackage(input: PackageFiles) {
  const read = (name: string): Bytes => {
    const value = input.get(normalize(name));
    if (!value) throw new Error(`Missing package file: ${name}`);
    return Bytes.from(value);
  };
  const manifest = JSON.parse(read("Manifest.json").toString());
  if (manifest.fileFormatVersion !== "1.0.0")
    throw new Error("Unsupported package format");
  const root = manifest.itemInfoEntries?.[manifest.rootModelIdentifier];
  if (!root || typeof root.path !== "string")
    throw new Error("Missing package root model");
  // A manifest item's path is relative to Data, never an absolute external path.
  const itemPath = (name: string): string => "Data/" + normalize(name);
  const modelPath = itemPath(root.path),
    data = read(modelPath),
    original = new Message(data);
  for (const field of original.fields)
    if (field.number >= 200 && field.number !== 502)
      throw new Error(
        "Espresso/NeuralNetwork and other non-MIL models are not supported; only MIL/ML Program .mlpackage is accepted",
      );
  if (!original.has(502))
    throw new Error("Package does not contain a MIL/ML Program model");
  if (original.int(10)) throw new Error("Updatable models are not supported");
  const desc = original.child(2);
  if ([13, 20, 21, 50].some((n) => desc.has(n)))
    throw new Error(
      "Stateful, multifunction and training models are not supported yet",
    );
  let metadataJSON: string | undefined,
    featuresJSON: string | undefined,
    weightRoot: string | undefined;
  for (const item of Object.values(manifest.itemInfoEntries) as any[]) {
    if (item.author !== "com.apple.CoreML") continue;
    if (item.name === "Metadata.json")
      metadataJSON = read(itemPath(item.path)).toString();
    if (item.name === "FeatureDescriptions.json")
      featuresJSON = read(itemPath(item.path)).toString();
    if (item.name === "weights") weightRoot = itemPath(item.path);
  }
  const model = overlayDescription(original, metadataJSON, featuresJSON);
  return { read, data, root, model, weightRoot };
}
export interface MetadataOptions {
  modelName?: string;
}
/** Read package metadata without generating compiled model files. */
export function metadataPackage(
  input: PackageFiles,
  options: MetadataOptions = {},
): PackageMetadata {
  const { read, model, weightRoot } = loadPackage(input);
  readWeights(model, weightRoot, read);
  return metadataObject(model, options.modelName ?? "Model");
}
export function compilePackage(
  input: PackageFiles,
  options: CompileOptions = {},
): Map<string, Uint8Array> {
  const { read, data, root, model, weightRoot } = loadPackage(input),
    name = options.modelName ?? "Model";
  checkDeploymentTarget(model.int(1), options);
  if (
    options.packageMetadataJSON !== undefined &&
    typeof options.packageMetadataJSON !== "boolean"
  )
    throw new Error("packageMetadataJSON must be a boolean");
  const result = new Map<string, Bytes>([
    ["model.mil", Bytes.from(programText(model.child(502), model.int(1)))],
    ["metadata.json", Bytes.from(appleJSON([metadata(model, name)]))],
    ["coremldata.bin", container(model)],
    [
      "analytics/coremldata.bin",
      analytics(data, root.name?.replace(/\.[^.]+$/, "") ?? "model"),
    ],
  ]);
  if (options.packageMetadataJSON === false) result.delete("metadata.json");
  for (const [name, data] of readWeights(model, weightRoot, read))
    result.set(name, data);
  if (options.encryptionKey) {
    result.delete("metadata.json");
    for (const [name, data] of result)
      result.set(name, encryptBytes(data, options.encryptionKey));
    result.set(
      "encryptionInfo/coremldata.bin",
      encryptionInfo(options.encryptionKey),
    );
  }
  return result;
}
function readWeights(
  model: Message,
  weightRoot: string | undefined,
  read: (name: string) => Bytes,
): Map<string, Bytes> {
  const result = new Map<string, Bytes>();
  for (const raw of model.child(502).map(2).values()) {
    const fn = new Message(raw);
    for (const block of fn.map(3).values())
      for (const op of new Message(block).children(3))
        for (const raw of op.map(5).values()) {
          const value = new Message(raw);
          if (!value.has(5)) continue;
          const blob = value.child(5),
            name = blob.text(1);
          if (!name.startsWith("@model_path/weights/"))
            throw new Error("Unsupported blob path");
          if (!weightRoot)
            throw new Error("Model references weights without manifest entry");
          const relative = normalize(name.slice("@model_path/weights/".length)),
            weight = read(weightRoot + "/" + relative),
            offset = blob.int(2);
          if (offset < 0 || weight.length - offset < 64)
            throw new Error("Weight blob offset out of bounds");
          if (weight.readUInt32LE(offset) !== 0xdeadbeef)
            throw new Error("Invalid weight blob sentinel");
          const size = weight.readBigUInt64LE(offset + 8),
            start = weight.readBigUInt64LE(offset + 16);
          if (
            start > BigInt(weight.length) ||
            size > BigInt(weight.length) - start
          )
            throw new Error("Weight blob data out of bounds");
          result.set("weights/" + relative, weight);
        }
  }
  return result;
}
const strbin = (s: string) =>
  Bytes.concat([u64(Bytes.byteLength(s)), Bytes.from(s)]);
function analytics(data: Bytes, name: string): Bytes {
  return Bytes.concat([
    strbin("NeuralNetworkModelDetails"),
    u64(2),
    strbin("containsCustomLayer"),
    strbin("0"),
    strbin("modelDimension"),
    strbin("0"),
    strbin("SpecificationDetails"),
    u64(2),
    strbin("modelHash"),
    strbin(Bytes.from(sha256(data)).toString("base64")),
    strbin("modelName"),
    strbin(name),
  ]);
}
function container(model: Message): Bytes {
  const desc = canonicalDescription(model.child(2)).encode();
  return Bytes.concat([
    u32(502),
    u32(model.int(1) >= 9 ? 9 : model.int(1) >= 8 ? 8 : 5),
    Bytes.alloc(20),
    strbin("generic"),
    u64(model.int(1)),
    Bytes.alloc(24),
    u64(desc.length),
    desc,
    u32(502),
    Bytes.alloc(12),
  ]);
}
export function canonicalContainer(input: Uint8Array): Uint8Array {
  const data = Bytes.from(input);
  if (data.length < 99 || data.readUInt32LE() !== 502)
    throw new Error("Unsupported compiled container");
  const size = data.readBigUInt64LE(75);
  if (size > BigInt(data.length - 99))
    throw new Error("Invalid compiled description length");
  const desc = canonicalDescription(
    new Message(data.subarray(83, 83 + Number(size))),
  ).encode();
  return Bytes.concat([
    data.subarray(0, 75),
    u64(desc.length),
    desc,
    data.subarray(83 + Number(size)),
  ]);
}
