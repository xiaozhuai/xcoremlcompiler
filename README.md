# xcoremlcompiler

A cross-platform compiler that converts Core ML MIL/ML Program `.mlpackage` models into `.mlmodelc` directories, with optional encryption. Legacy Espresso models are not supported.

## CLI

```sh
npm install -g xcoremlcompiler

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
npm install xcoremlcompiler
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
