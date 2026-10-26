// Node.js is used only at the CLI boundary. The compilation core is portable.
import fs from "node:fs/promises";
import path from "node:path";
import {
  compilePackage,
  metadataPackage,
  type CompileOptions,
  type PackageFiles,
} from "../core/compiler.js";
import { parseEncryptionKey, type EncryptionKey } from "../core/encryption.js";
import type { PackageMetadata } from "../core/metadata.js";
export interface DirectoryOptions extends Omit<
  CompileOptions,
  "modelName" | "encryptionKey"
> {
  encryptionKeyPath?: string;
  createArchive?: boolean;
}
function inside(root: string, child: string): boolean {
  const rel = path.relative(root, child);
  return (
    rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel)
  );
}
export async function readEncryptionKey(file: string): Promise<EncryptionKey> {
  return parseEncryptionKey(await fs.readFile(file));
}
async function resolvedPath(output: string): Promise<string> {
  let ancestor = path.resolve(output);
  for (;;) {
    try {
      await fs.lstat(ancestor);
      break;
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
      const next = path.dirname(ancestor);
      if (next === ancestor) throw new Error("Invalid output path");
      ancestor = next;
    }
  }
  return path.join(
    await fs.realpath(ancestor),
    path.relative(ancestor, path.resolve(output)),
  );
}
async function packageSource(input: string): Promise<string> {
  const source = await fs.realpath(input);
  if (
    path.extname(source).toLowerCase() !== ".mlpackage" ||
    !(await fs.stat(source)).isDirectory()
  )
    throw new Error(
      "Only MIL/ML Program .mlpackage inputs are supported; standalone .mlmodel and Espresso inputs are rejected",
    );
  return source;
}
async function readPackageFiles(
  source: string,
): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  async function readDirectory(directory: string) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error("Package symlinks are not supported");
      if (entry.isDirectory()) await readDirectory(file);
      else if (entry.isFile())
        files.set(
          path.relative(source, file).split(path.sep).join("/"),
          await fs.readFile(file),
        );
    }
  }
  await readDirectory(source);
  return files;
}
export async function metadataDirectory(
  input: string,
): Promise<PackageMetadata[]> {
  const files = await readPackageFiles(await packageSource(input));
  return metadataPackage(files, {
    modelName: path.basename(input, path.extname(input)),
  });
}
export async function compileDirectory(
  input: string,
  outputPath: string,
  options: DirectoryOptions = {},
): Promise<string> {
  const source = await packageSource(input);
  const output = await resolvedPath(outputPath);
  if (inside(source, output))
    throw new Error("Output must be outside source directory");
  try {
    await fs.lstat(output);
    throw new Error("Output already exists");
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
  }
  const files = await readPackageFiles(source);
  const result = compilePackage(files as PackageFiles, {
    packageMetadataJSON: options.packageMetadataJSON,
    platform: options.platform,
    deploymentTarget: options.deploymentTarget,
    onWarning: options.onWarning,
    modelName: path.basename(input, path.extname(input)),
    encryptionKey: options.encryptionKeyPath
      ? await readEncryptionKey(options.encryptionKeyPath)
      : undefined,
  });
  const parent = path.dirname(output);
  await fs.mkdir(parent, { recursive: true });
  const stage = await fs.mkdtemp(path.join(parent, ".xcoremlcompiler-"));
  try {
    if (options.createArchive) {
      const { writeArchive } = await import("./archive.js");
      const archive = path.join(stage, "model.mlarchive");
      await writeArchive(result, archive);
      // Do not replace an output created by another process during compilation.
      await fs.copyFile(archive, output, fs.constants.COPYFILE_EXCL);
      return output;
    }
    for (const [name, data] of result) {
      const file = path.join(stage, name);
      if (!inside(stage, file)) throw new Error("Invalid compiled output path");
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, data, { flag: "wx" });
    }
    await fs.rename(stage, output);
    return output;
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}
