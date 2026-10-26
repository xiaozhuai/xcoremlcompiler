import {
  compilePackage,
  metadataPackage,
  parseEncryptionKey,
  type CompileOptions,
  type MetadataOptions,
  type PackageMetadata,
  type PackageFiles,
  type TargetPlatform,
  type CompileWarning,
} from "xcoremlcompiler";
const input: PackageFiles = new Map<string, Uint8Array>();
const platform: TargetPlatform = "iOS";
const warnings: CompileWarning[] = [];
const options: CompileOptions = { modelName: "Example", platform, deploymentTarget: "18.0", packageMetadataJSON: false, onWarning: warning => warnings.push(warning) };
const result: Map<string, Uint8Array> = compilePackage(input, options);
const key: ReturnType<typeof parseEncryptionKey> = parseEncryptionKey(
  new Uint8Array(),
);
void result;
void key;
const metadataOptions: MetadataOptions = {modelName:"Example"};
const metadata: PackageMetadata = metadataPackage(input, metadataOptions);
const specificationVersion: number = metadata.specificationVersion;
void specificationVersion;
void metadata;
// @ts-expect-error Archive creation is CLI-only.
compilePackage(input, { createArchive: true });
