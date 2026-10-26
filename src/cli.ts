#!/usr/bin/env node
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { compileDirectory, metadataDirectory } from "./cli/filesystem.js";
import { referenceVersion } from "./core/compiler.js";
import { appleJSON } from "./core/metadata.js";
import { normalizePlatform, targetPlatforms } from "./core/compatibility.js";
try {
  await yargs(hideBin(process.argv))
    .scriptName("xcoremlcompiler")
    .usage("$0 <command> [options]")
    .command(
      "compile <input>",
      "Compile a MIL/ML Program .mlpackage",
      (builder) =>
        builder
          .positional("input", {
            type: "string",
            demandOption: true,
            describe: "MIL .mlpackage directory",
          })
          .option("output", {
            alias: "o",
            type: "string",
            demandOption: true,
            describe:
              "Exact output path (.mlmodelc directory or .mlarchive file)",
          })
          .option("encrypt", {
            type: "string",
            describe: "Apple .mlmodelkey file",
          })
          .option("create-archive", {
            type: "boolean",
            default: false,
            describe: "Write a .mlarchive ZIP file to --output",
          })
          .option("package-metadata-json", {
            type: "string",
            choices: ["YES", "NO"] as const,
            default: "YES" as const,
            describe: "Include metadata.json in the compiled directory",
          })
          .option("platform", {
            type: "string",
            choices: targetPlatforms,
            coerce: normalizePlatform,
            describe: "Check model compatibility with this Apple platform",
          })
          .option("deployment-target", {
            type: "string",
            describe:
              "Check compatibility with this OS version (for example 18.0)",
          }),
      async (args) => {
        console.log(
          await compileDirectory(args.input, args.output, {
            encryptionKeyPath: args.encrypt,
            createArchive: args["create-archive"],
            packageMetadataJSON: args["package-metadata-json"] === "YES",
            platform: args.platform,
            deploymentTarget: args["deployment-target"],
            onWarning: (warning) =>
              console.warn(`xcoremlcompiler: warning: ${warning.message}`),
          }),
        );
      },
    )
    .command(
      "metadata <input>",
      "Display metadata for a MIL/ML Program .mlpackage as JSON",
      (builder) =>
        builder.positional("input", {
          type: "string",
          demandOption: true,
          describe: "MIL .mlpackage directory",
        }),
      async (args) => {
        process.stdout.write(appleJSON([await metadataDirectory(args.input)]));
      },
    )
    .command(
      "version",
      "Show compiler format version",
      () => {},
      () =>
        console.log(
          `xcoremlcompiler experimental (format ${referenceVersion})`,
        ),
    )
    .version(`0.1.0 (Apple format ${referenceVersion})`)
    .help()
    .strict()
    .demandCommand(1)
    .exitProcess(false)
    .parseAsync();
} catch (error: unknown) {
  console.error(
    "xcoremlcompiler:",
    error instanceof Error ? error.message : "Compilation failed",
  );
  process.exitCode = 1;
}
