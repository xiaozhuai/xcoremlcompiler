# xcoremlcompiler

A cross-platform compiler that converts CoreML MIL/ML Program `.mlpackage` models into `.mlmodelc` directories, with optional encryption. Legacy Espresso models are not supported.

## CLI

```sh
pnpm install -g xcoremlcompiler

xcoremlcompiler compile Example.mlpackage --output Example.mlmodelc
xcoremlcompiler metadata Example.mlpackage
xcoremlcompiler compile Example.mlpackage --output Example.encrypted.mlmodelc --encrypt Example.mlmodelkey
xcoremlcompiler compile Example.mlpackage --output Example.mlarchive --create-archive
xcoremlcompiler compile Example.mlpackage --output Example.mlmodelc --package-metadata-json NO --platform iOS --deployment-target 18.0
```

`--output` specifies the full output path: a `.mlmodelc` directory, or a `.mlarchive` file with `--create-archive` (CLI only). Run `xcoremlcompiler --help` for available options.

Metadata JSON is included by default. Platform and deployment target checks warn about incompatible OS versions and continue compilation.

## Library

```sh
pnpm install xcoremlcompiler
```

ESM:

```js
import { compilePackage, metadataPackage, parseEncryptionKey } from "xcoremlcompiler";
```

CommonJS:

```js
const { compilePackage, metadataPackage, parseEncryptionKey } = require("xcoremlcompiler");
```

Pass all `.mlpackage` files as a `Map<string, Uint8Array>`, keyed by package-relative paths such as `Manifest.json` and `Data/com.apple.CoreML/model.mlmodel`.

```ts
const outputFiles = compilePackage(packageFiles, {
  modelName: "Example",
  packageMetadataJSON: false,
  platform: "iOS",
  deploymentTarget: "18.0",
  onWarning: warning => console.warn(warning.message),
  // Optional: encrypt with the contents of a .mlmodelkey file.
  // encryptionKey: parseEncryptionKey(keyFileBytes),
});
```

`outputFiles` is a `Map<string, Uint8Array>` containing the compiled files. Save its entries under `Example.mlmodelc/`.

Read model metadata as an array:

```ts
const [metadata] = metadataPackage(packageFiles, { modelName: "Example" });
```

## Testing

```sh
pnpm install
pnpm test
```

`pnpm test` builds the Node.js and browser bundles, runs TypeScript type checking, and executes the Node.js test suite. Local tests use the committed fixtures in `testdata/corpus.json`; macOS and Apple's compiler are not required.

The suite checks:

- Compilation and metadata against expected outputs from Apple's Core ML compiler version `3500.32.1`, using independently constructed synthetic models, weights, and test keys. Cases include FP16 and FP32 operators, inline constants, external weights, casts, and model specification versions.
- Output file lists and byte contents. JSON is compared structurally, and `coremldata.bin` is canonicalized when bytes differ to allow equivalent protobuf field ordering.
- Encryption, decryption round trips, archives, CLI options, deployment warnings, invalid inputs, and source file preservation.
- ESM, CommonJS, and browser bundles. Portability checks execute the bundles in a JavaScript VM without Node.js globals such as `process`, `Buffer`, or `require`; they do not launch a real browser.

### CI reference generation

The [conformance workflow](.github/workflows/test.yml) first runs on macOS, downloads the pinned Apple reference compiler, verifies its SHA-256 checksum, and generates fresh synthetic weights, encryption keys, and reference outputs. It then runs the test suite against that generated corpus on Linux, Windows, and macOS with Node.js 22 and 24.

To regenerate reference fixtures locally, use macOS and the same reference compiler version. The output directory must not already exist:

```sh
pnpm run build
node tools/prepare-conformance.mjs --reference /path/to/coremlcompiler --output /tmp/xcoreml-conformance
XCOREML_CONFORMANCE_FILE=/tmp/xcoreml-conformance/corpus.json pnpm test
```

### Optional Core ML runtime validation

Output conformance checks compiled artifacts. To also compare inference results on macOS with Swift and Core ML available, generate a differential report and run the runtime validator:

```sh
pnpm run build
node tools/verify.mjs --reference /path/to/coremlcompiler --synthetic --work /tmp/xcoreml-runtime
swift tools/validate-runtime.swift /tmp/xcoreml-runtime/report.json
```

The work directory must not already exist. The validator loads the reference and generated models with CPU-only execution and compares output shapes and values for unencrypted synthetic cases that compiled successfully. This is an optional check, separate from `pnpm test` and the conformance CI workflow.
