export {
  compilePackage,
  canonicalContainer,
  referenceVersion,
} from "./core/compiler.js";
export type { CompileOptions, PackageFiles } from "./core/compiler.js";
export type { TargetPlatform, CompileWarning } from "./core/compatibility.js";
export {
  parseEncryptionKey,
  decryptForVerification,
} from "./core/encryption.js";
export type { EncryptionKey } from "./core/encryption.js";
