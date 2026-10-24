// Portable byte storage using only ECMAScript typed arrays and standard Web APIs.
// This module intentionally has no runtime-specific imports or globals.
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
export class Bytes extends Uint8Array {
  static alloc(size: number): Bytes {
    return new Bytes(size);
  }
  static from(value: any, encoding?: any): Bytes {
    if (typeof value === "string") {
      if (encoding === "hex") {
        if (value.length % 2) throw new Error("Invalid hexadecimal bytes");
        return new Bytes(
          value.match(/../g)?.map((s: string) => parseInt(s, 16)) ?? [],
        );
      }
      if (encoding === "base64") {
        const s = atob(value);
        return new Bytes(Array.from(s, (c) => c.charCodeAt(0)));
      }
      return new Bytes(encoder.encode(value));
    }
    if (value instanceof ArrayBuffer) return new Bytes(new Uint8Array(value));
    return new Bytes(value);
  }
  static concat(parts: readonly Uint8Array[]): Bytes {
    const result = new Bytes(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  }
  static byteLength(value: string): number {
    return encoder.encode(value).length;
  }
  override subarray(begin?: number, end?: number): Bytes {
    const data = super.subarray(begin, end);
    return new Bytes(data.buffer, data.byteOffset, data.byteLength);
  }
  override toString(encoding = "utf8"): string {
    if (encoding === "hex")
      return Array.from(this, (n) => n.toString(16).padStart(2, "0")).join("");
    if (encoding === "base64") {
      let s = "";
      for (let i = 0; i < this.length; i += 16384)
        s += String.fromCharCode(...this.subarray(i, i + 16384));
      return btoa(s);
    }
    return decoder.decode(this);
  }
  equals(other: Uint8Array): boolean {
    return this.length === other.length && this.every((n, i) => n === other[i]);
  }
  copy(
    target: Uint8Array,
    targetStart = 0,
    sourceStart = 0,
    sourceEnd = this.length,
  ): void {
    target.set(this.subarray(sourceStart, sourceEnd), targetStart);
  }
  write(value: string, offset = 0): void {
    this.set(encoder.encode(value), offset);
  }
  private view(): DataView {
    return new DataView(this.buffer, this.byteOffset, this.byteLength);
  }
  readUInt32LE(offset = 0): number {
    return this.view().getUint32(offset, true);
  }
  readUInt16LE(offset = 0): number {
    return this.view().getUint16(offset, true);
  }
  readInt16LE(offset = 0): number {
    return this.view().getInt16(offset, true);
  }
  readInt8(offset = 0): number {
    return this.view().getInt8(offset);
  }
  readBigUInt64LE(offset = 0): bigint {
    return this.view().getBigUint64(offset, true);
  }
  readBigUInt64BE(offset = 0): bigint {
    return this.view().getBigUint64(offset, false);
  }
  readFloatLE(offset = 0): number {
    return this.view().getFloat32(offset, true);
  }
  readDoubleLE(offset = 0): number {
    return this.view().getFloat64(offset, true);
  }
  writeUInt32LE(value: number, offset = 0): void {
    this.view().setUint32(offset, value, true);
  }
  writeUInt16LE(value: number, offset = 0): void {
    this.view().setUint16(offset, value, true);
  }
  writeBigUInt64LE(value: bigint, offset = 0): void {
    this.view().setBigUint64(offset, value, true);
  }
  writeDoubleBE(value: number, offset = 0): void {
    this.view().setFloat64(offset, value, false);
  }
}
