import compiler = require("xcoremlcompiler");
const input: compiler.PackageFiles = new Map<string, Uint8Array>();
const platform: compiler.TargetPlatform = "iOS";
const warnings: compiler.CompileWarning[] = [];
const options: compiler.CompileOptions = { modelName: "Example", platform, deploymentTarget: "18.0", packageMetadataJSON: false, onWarning: warning => warnings.push(warning) };
const result: Map<string, Uint8Array> = compiler.compilePackage(input, options);
const key: ReturnType<typeof compiler.parseEncryptionKey> =
  compiler.parseEncryptionKey(new Uint8Array());
void result;
void key;
const metadataOptions: compiler.MetadataOptions = {modelName:"Example"};
const metadata: compiler.PackageMetadata = compiler.metadataPackage(input, metadataOptions);
const specificationVersion: number = metadata.specificationVersion;
void specificationVersion;
void metadata;
// @ts-expect-error Archive creation is CLI-only.
compiler.compilePackage(input, { createArchive: true });
