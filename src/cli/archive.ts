import JSZip from "jszip";
import { createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export async function writeArchive(
  files: ReadonlyMap<string, Uint8Array>,
  destination: string,
): Promise<void> {
  const zip = new JSZip(),
    date = new Date();
  for (const [name, data] of files) {
    if (data.byteLength >= 0xffffffff)
      throw new Error("Archive entry exceeds JSZip's ZIP32 size limit");
    const parts = name.split("/");
    for (let i = 1; i < parts.length; i++) {
      const directory = parts.slice(0, i).join("/") + "/";
      if (!zip.files[directory])
        zip.file(directory, null, {
          dir: true,
          createFolders: false,
          date,
          unixPermissions: 0o40755,
        });
    }
    zip.file(name, data, {
      createFolders: false,
      date,
      unixPermissions: 0o100644,
    });
  }
  if (Object.keys(zip.files).length >= 0xffff)
    throw new Error("Archive exceeds JSZip's ZIP32 entry limit");
  let size = 0;
  const limit = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      callback(
        size >= 0xffffffff
          ? new Error("Archive exceeds JSZip's ZIP32 size limit")
          : null,
        chunk,
      );
    },
  });
  await pipeline(
    zip.generateNodeStream({
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
      platform: "UNIX",
      streamFiles: false,
    }),
    limit,
    createWriteStream(destination, { flags: "wx" }),
  );
}
