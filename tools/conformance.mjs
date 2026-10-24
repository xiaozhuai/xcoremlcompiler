import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { canonicalContainer, decryptForVerification } from "xcoremlcompiler";
export const sha256 = (b) => createHash("sha256").update(b).digest("hex");
export async function files(root) {
  const result = {};
  async function visit(p) {
    for (const e of await fs.readdir(p, { withFileTypes: true })) {
      const f = path.join(p, e.name);
      if (e.isSymbolicLink())
        throw new Error("Symlinks are not supported in conformance trees");
      if (e.isDirectory()) await visit(f);
      else
        result[path.relative(root, f).split(path.sep).join("/")] =
          await fs.readFile(f);
    }
  }
  await visit(root);
  return result;
}
export async function fingerprint(root) {
  const result = {};
  for (const [name, data] of Object.entries(await files(root)))
    result[name] = sha256(data);
  return result;
}
export async function writeFixture(root, c) {
  const input = path.join(root, c.name + ".mlpackage");
  for (const [name, encoded] of Object.entries(c.input)) {
    const file = path.join(input, name);
    if (!inside(input, file)) throw new Error("Invalid fixture path");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.from(encoded, "base64"));
  }
  return input;
}
export function inside(root, child) {
  const rel = path.relative(root, child);
  return (
    rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel)
  );
}
export async function compare(reference, actual, key) {
  const a = await files(reference),
    b = await files(actual),
    result = [];
  for (const name of [
    ...new Set([...Object.keys(a), ...Object.keys(b)]),
  ].sort()) {
    const ra = a[name],
      rb = b[name];
    const equal = !!ra && !!rb && ra.equals(rb);
    let orderOnly = false,
      firstDifference;
    if (ra && rb && !equal) {
      firstDifference = Math.min(ra.length, rb.length);
      for (let i = 0; i < firstDifference; i++)
        if (ra[i] !== rb[i]) {
          firstDifference = i;
          break;
        }
      if (name === "coremldata.bin") {
        try {
          const da = key ? decryptForVerification(ra, key) : ra,
            db = key ? decryptForVerification(rb, key) : rb;
          orderOnly = Buffer.from(canonicalContainer(da)).equals(
            Buffer.from(canonicalContainer(db)),
          );
        } catch {}
      }
      if (name.endsWith(".json")) {
        try {
          orderOnly = isDeepStrictEqual(JSON.parse(ra), JSON.parse(rb));
        } catch {}
      }
    }
    result.push({
      path: name,
      byte_equal: equal,
      order_only: orderOnly,
      first_difference: firstDifference,
      reference_sha256: ra && sha256(ra),
      actual_sha256: rb && sha256(rb),
    });
  }
  return result;
}
