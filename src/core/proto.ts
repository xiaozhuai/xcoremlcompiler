import { Bytes } from "./bytes.js";
// A protobuf wire codec. All integer payloads stay BigInt until explicitly read.
export function varint(value: bigint | number): Bytes {
  let n = BigInt.asUintN(64, BigInt(value));
  const bytes = [];
  while (n > 127n) {
    bytes.push(Number(n & 127n) | 128);
    n >>= 7n;
  }
  bytes.push(Number(n));
  return Bytes.from(bytes);
}
export function readVarint(data: Bytes, offset = 0): [bigint, number] {
  let value = 0n;
  for (let shift = 0n; shift < 70n; shift += 7n) {
    if (offset >= data.length) throw new Error("Truncated protobuf varint");
    const byte = data[offset++];
    value |= BigInt(byte & 127) << shift;
    if (byte < 128) return [value, offset];
  }
  throw new Error("Invalid protobuf varint");
}
export function field(number: number, payload: any, wire = 2): Bytes {
  const tag = varint(number * 8 + wire);
  if (wire === 0) return Bytes.concat([tag, varint(payload)]);
  const data = Bytes.from(payload);
  return Bytes.concat(
    wire === 2 ? [tag, varint(data.length), data] : [tag, data],
  );
}
export const str = (number: number, value: string) =>
  field(number, Bytes.from(value));
export class Message {
  fields: { number: number; wire: number; value: any }[];
  constructor(data: Bytes = Bytes.alloc(0)) {
    this.fields = [];
    let offset = 0;
    while (offset < data.length) {
      let tag: bigint;
      [tag, offset] = readVarint(data, offset);
      const number = Number(tag >> 3n),
        wire = Number(tag & 7n);
      if (!number || number > 0x1fffffff)
        throw new Error("Invalid protobuf field number");
      let value: any;
      if (wire === 0) [value, offset] = readVarint(data, offset);
      else if ([1, 2, 5].includes(wire)) {
        let size = wire === 1 ? 8 : 4;
        if (wire === 2) {
          let n;
          [n, offset] = readVarint(data, offset);
          if (n > BigInt(data.length - offset))
            throw new Error("Truncated protobuf field");
          size = Number(n);
        }
        if (size > data.length - offset)
          throw new Error("Truncated protobuf field");
        value = data.subarray(offset, offset + size);
        offset += size;
      } else throw new Error(`Unsupported protobuf wire type ${wire}`);
      this.fields.push({ number, wire, value });
    }
  }
  all(number: number): any[] {
    return this.fields.filter((f) => f.number === number).map((f) => f.value);
  }
  has(number: number): boolean {
    return this.fields.some((f) => f.number === number);
  }
  get(number: number, fallback: any = Bytes.alloc(0)): any {
    return this.all(number).at(-1) ?? fallback;
  }
  int(number: number, fallback = 0): number {
    const value = BigInt.asIntN(64, this.get(number, BigInt(fallback)));
    const n = Number(value);
    if (!Number.isSafeInteger(n))
      throw new Error("Integer exceeds exact JS range");
    return n;
  }
  text(number: number): string {
    return this.get(number).toString("utf8");
  }
  child(number: number): Message {
    return new Message(this.get(number));
  }
  children(number: number): Message[] {
    return this.all(number).map((v) => new Message(v));
  }
  map(number: number): Map<string, Bytes> {
    return new Map(this.children(number).map((e) => [e.text(1), e.get(2)]));
  }
  encode() {
    return Bytes.concat(
      this.fields.map((f) => field(f.number, f.value, f.wire)),
    );
  }
  set(number: number, value: any, wire = 2): Message {
    const result = new Message();
    result.fields = this.fields
      .filter((f) => f.number !== number)
      .concat([{ number, value, wire }]);
    result.fields.sort((a, b) => a.number - b.number);
    return result;
  }
  packed(number: number, width = 0): any[] {
    const result = [];
    for (const f of this.fields.filter((f) => f.number === number)) {
      if (f.wire === 0) {
        result.push(f.value);
        continue;
      }
      let offset = 0;
      while (offset < f.value.length) {
        if (width) {
          if (f.value.length - offset < width)
            throw new Error("Truncated packed value");
          result.push(
            width === 4
              ? f.value.readFloatLE(offset)
              : f.value.readDoubleLE(offset),
          );
          offset += width;
        } else {
          let value: any;
          [value, offset] = readVarint(f.value, offset);
          result.push(value);
        }
      }
    }
    return result;
  }
}
export const keys = <T>(map: Map<string, T>): string[] =>
  [...map.keys()].sort();
export function u64(value: bigint | number): Bytes {
  const b = Bytes.alloc(8);
  b.writeBigUInt64LE(BigInt(value));
  return b;
}
export function u32(value: number): Bytes {
  const b = Bytes.alloc(4);
  b.writeUInt32LE(value);
  return b;
}
