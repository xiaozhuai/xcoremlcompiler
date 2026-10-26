export {
  compilePackage,
  metadataPackage,
  canonicalContainer,
  referenceVersion,
} from "./core/compiler.js";
export type {
  CompileOptions,
  MetadataOptions,
  PackageFiles,
} from "./core/compiler.js";
export type { TargetPlatform, CompileWarning } from "./core/compatibility.js";
export type { PackageMetadata, FeatureMetadata } from "./core/metadata.js";
export {
  parseEncryptionKey,
  decryptForVerification,
} from "./core/encryption.js";
export type { EncryptionKey } from "./core/encryption.js";
