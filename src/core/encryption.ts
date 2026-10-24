import { cbc } from "@noble/ciphers/aes.js";
import { parse } from "plist";
import { Bytes } from "./bytes.js";
import { u32, u64 } from "./proto.js";
export interface EncryptionKey {
  key: Uint8Array;
  iv: Uint8Array;
  identifier: string;
  usesCodeSigningIdentity: boolean;
}
export function parseEncryptionKey(input: Uint8Array): EncryptionKey {
  const data = Bytes.from(input);
  let raw: any;
  try {
    raw = parse(
      data.subarray(0, 8).toString() === "bplist00" ? data : data.toString(),
    );
  } catch {
    throw new Error("Invalid .mlmodelkey plist");
  }
  if (
    !raw ||
    typeof raw !== "object" ||
    raw.Version !== 1 ||
    !(raw.Key instanceof Uint8Array) ||
    raw.Key.length !== 16 ||
    !(raw.IV instanceof Uint8Array) ||
    raw.IV.length !== 16 ||
    typeof raw.KeyIdentifier !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      raw.KeyIdentifier,
    ) ||
    (raw.UsesCodeSigningIdentityForEncryption !== undefined &&
      typeof raw.UsesCodeSigningIdentityForEncryption !== "boolean")
  )
    throw new Error(
      "Unsupported .mlmodelkey version, key/IV length, or identifier",
    );
  return {
    key: Bytes.from(raw.Key),
    iv: Bytes.from(raw.IV),
    identifier: raw.KeyIdentifier,
    usesCodeSigningIdentity: raw.UsesCodeSigningIdentityForEncryption ?? false,
  };
}
function header(size: number, pages: number): Bytes {
  const b = Bytes.alloc(96);
  b.write("LMNE");
  b.writeUInt32LE(0x60000002, 4);
  b.writeBigUInt64LE(BigInt(size), 8);
  b.writeBigUInt64LE(BigInt(pages), 16);
  return b;
}
export function encryptBytes(input: Uint8Array, key: EncryptionKey): Bytes {
  const data = Bytes.from(input),
    pages = Math.ceil((data.length + 96) / 4096),
    plain = Bytes.alloc(pages * 4096),
    h = header(data.length, pages);
  h.copy(plain);
  data.copy(plain, 96);
  const result = Bytes.alloc(plain.length);
  for (let offset = 0; offset < plain.length; offset += 4096)
    result.set(
      cbc(key.key, key.iv, { disablePadding: true }).encrypt(
        plain.subarray(offset, offset + 4096),
      ),
      offset,
    );
  h.copy(result, 0, 0, 80);
  return result;
}
export function encryptionInfo(key: EncryptionKey): Bytes {
  const id = Bytes.from(key.identifier),
    body = Bytes.concat([
      u64(id.length),
      id,
      u32(key.usesCodeSigningIdentity ? 1 : 0),
    ]);
  return Bytes.concat([header(body.length, 0), body]);
}
export function decryptForVerification(
  input: Uint8Array,
  key: EncryptionKey,
): Uint8Array {
  const data = Bytes.from(input);
  if (
    data.length < 96 ||
    data.subarray(0, 4).toString() !== "LMNE" ||
    data.readUInt32LE(4) !== 0x60000002
  )
    throw new Error("Invalid encrypted model header");
  const size = data.readBigUInt64LE(8),
    pages = data.readBigUInt64LE(16);
  if (size > BigInt(data.length - 96))
    throw new Error("Invalid encrypted model size");
  if (!pages) return data.subarray(96, 96 + Number(size));
  if (pages * 4096n !== BigInt(data.length))
    throw new Error("Invalid encrypted page count");
  const restored = Bytes.from(data);
  restored.set(
    cbc(key.key, key.iv, { disablePadding: true }).encrypt(
      data.subarray(0, 80),
    ),
  );
  const plain = Bytes.alloc(data.length);
  for (let offset = 0; offset < data.length; offset += 4096)
    plain.set(
      cbc(key.key, key.iv, { disablePadding: true }).decrypt(
        restored.subarray(offset, offset + 4096),
      ),
      offset,
    );
  if (!plain.subarray(0, 96).equals(header(Number(size), Number(pages))))
    throw new Error("Encrypted model key/header mismatch");
  return plain.subarray(96, 96 + Number(size));
}
