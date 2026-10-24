import { Bytes } from "./bytes.js";
import { Message, keys } from "./proto.js";
export const referenceVersion = "3500.32.1";
export const dtypes = new Map([
  [1, "bool"],
  [2, "string"],
  [10, "fp16"],
  [11, "fp32"],
  [12, "fp64"],
  [13, "bf16"],
  [21, "int8"],
  [22, "int16"],
  [23, "int32"],
  [24, "int64"],
  [25, "int4"],
  [31, "uint8"],
  [32, "uint16"],
  [33, "uint32"],
  [34, "uint64"],
  [35, "uint4"],
  [36, "uint2"],
  [37, "uint1"],
  [38, "uint6"],
  [39, "uint3"],
]);
const opsets = new Map([
  ["CoreML5", "ios15"],
  ["CoreML6", "ios16"],
  ["CoreML7", "ios17"],
  ["CoreML8", "ios18"],
  ["CoreML9", "ios19"],
]);
const supported = new Set(
  `const identity relu leaky_relu prelu elu selu gelu sigmoid sigmoid_hard tanh softmax softplus softplus_parametric softsign thresholded_relu clamped_relu linear add sub mul real_div floor_div mod pow maximum minimum equal not_equal greater greater_equal less less_equal logical_and logical_or logical_xor logical_not abs acos asin atan atanh ceil cos cosh erf exp exp2 floor inverse log round rsqrt sign sin sinh sqrt square tan clip cast conv conv_transpose avg_pool max_pool l2_pool concat expand_dims squeeze reshape transpose flatten2d shape tile pad slice_by_index slice_by_size split stack gather gather_along_axis gather_nd scatter scatter_along_axis scatter_nd matmul batch_norm instance_norm layer_norm l2_norm local_response_norm reduce_sum reduce_mean reduce_max reduce_min reduce_prod reduce_l1_norm reduce_l2_norm reduce_log_sum reduce_log_sum_exp reduce_sum_square reduce_argmax reduce_argmin upsample_bilinear upsample_nearest_neighbor resize_bilinear crop crop_resize pixel_shuffle pixel_unshuffle depth_to_space space_to_depth reverse reverse_sequence cumsum fill range_1d select topk non_zero one_hot`.split(
    /\s+/,
  ),
);
export const quote = JSON.stringify;
export function hexFloat(value: number): string {
  if (!Number.isFinite(value))
    throw new Error("Non-finite MIL constants are not supported");
  const sign = value < 0 || Object.is(value, -0) ? "-" : "";
  const x = Math.abs(value);
  if (!x) return sign + "0x0p+0";
  const b = Bytes.alloc(8);
  b.writeDoubleBE(x);
  const bits = b.readBigUInt64BE();
  let exponent = Number((bits >> 52n) & 2047n) - 1023;
  let fraction = bits & ((1n << 52n) - 1n);
  if (exponent === -1023) {
    exponent = -1022;
    while ((fraction & (1n << 52n)) === 0n) {
      fraction <<= 1n;
      exponent--;
    }
    fraction &= (1n << 52n) - 1n;
  }
  const tail = fraction.toString(16).padStart(13, "0").replace(/0+$/, "");
  return `${sign}0x1${tail ? "." + tail : ""}p${exponent >= 0 ? "+" : ""}${exponent}`;
}
export function halfFloat(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1,
    e = (bits >> 10) & 31,
    f = bits & 1023;
  if (!e) return sign * f * 2 ** -24;
  if (e === 31) return f ? NaN : sign * Infinity;
  return sign * (1024 + f) * 2 ** (e - 25);
}
export function tensorInfo(type: Message): [string, number[]] {
  if (!type.has(1)) throw new Error("Only tensor MIL types are supported here");
  const tensor = type.child(1),
    dtype = dtypes.get(tensor.int(1));
  if (!dtype) throw new Error("Unsupported MIL data type");
  const shape = tensor.children(3).map((d) => {
    if (!d.has(1))
      throw new Error("Symbolic MIL dimensions are not supported yet");
    return d.child(1).int(1);
  });
  if (tensor.int(2) !== shape.length) throw new Error("Invalid MIL rank");
  return [dtype, shape];
}
function typeText(type: Message, modern = false): string {
  if (type.has(1)) {
    const [dtype, shape] = tensorInfo(type);
    if (modern && !shape.length) return dtype;
    return `tensor<${dtype}, [${shape.join(", ")}]>`;
  }
  if (type.has(4)) {
    const d = type.child(4);
    return `dict<${typeText(d.child(1), modern)}, ${typeText(d.child(2), modern)}>`;
  }
  throw new Error("Unsupported MIL value type");
}
function named(n: Message, modern = false): string {
  if (!/^[A-Za-z_][A-Za-z0-9_@]*$/.test(n.text(1)))
    throw new Error("Unsupported MIL identifier");
  return `${typeText(n.child(2), modern)} ${n.text(1)}`;
}
function immediate(value: Message): string {
  const [dtype, shape] = tensorInfo(value.child(2)),
    t = value.child(3).child(1);
  let values = [];
  if (t.has(1)) values = t.child(1).packed(1, 4).map(hexFloat);
  else if (t.has(2))
    values = t
      .child(2)
      .packed(1)
      .map((v) => BigInt.asIntN(32, v).toString());
  else if (t.has(3))
    values = t
      .child(3)
      .packed(1)
      .map((v) => (v ? "true" : "false"));
  else if (t.has(4))
    values = t
      .child(4)
      .all(1)
      .map((v) => quote(v.toString("utf8")));
  else if (t.has(5))
    values = t
      .child(5)
      .packed(1)
      .map((v) => BigInt.asIntN(64, v).toString());
  else if (t.has(6)) values = t.child(6).packed(1, 8).map(hexFloat);
  else if (t.has(7)) {
    const raw = t.child(7).get(1),
      size = ["fp16", "bf16", "int16", "uint16"].includes(dtype)
        ? 2
        : ["int8", "uint8"].includes(dtype)
          ? 1
          : 0;
    if (!size || raw.length % size)
      throw new Error("Unsupported or malformed byte tensor");
    for (let i = 0; i < raw.length; i += size) {
      let v: string = "";
      switch (dtype) {
        case "fp16":
          v = hexFloat(halfFloat(raw.readUInt16LE(i)));
          break;
        case "bf16": {
          const b = Bytes.alloc(4);
          b.writeUInt16LE(raw.readUInt16LE(i), 2);
          v = hexFloat(b.readFloatLE());
          break;
        }
        case "int16":
          v = String(raw.readInt16LE(i));
          break;
        case "uint16":
          v = String(raw.readUInt16LE(i));
          break;
        case "int8":
          v = String(raw.readInt8(i));
          break;
        case "uint8":
          v = String(raw[i]);
          break;
      }
      values.push(v);
    }
  }
  let count = 1;
  for (const d of shape) {
    count *= d;
    if (d < 0 || !Number.isSafeInteger(count))
      throw new Error("Invalid tensor dimensions");
  }
  if (values.length !== count)
    throw new Error("MIL immediate count does not match shape");
  return shape.length ? `[${values.join(", ")}]` : values[0];
}
export function valueText(value: Message, modern = false): string {
  const type = value.child(2),
    kind = typeText(type, modern);
  if (value.has(5)) {
    const b = value.child(5);
    return `${kind}(BLOBFILE(path = ${modern ? "string" : "tensor<string, []>"}(${quote(b.text(1))}), offset = ${modern ? "uint64" : "tensor<uint64, []>"}(${b.int(2)})))`;
  }
  if (type.has(4)) {
    const pairs = value
      .child(3)
      .child(4)
      .children(1)
      .map((e) => [immediate(e.child(1)), immediate(e.child(2))])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return `${kind}({${pairs.map(([k, v]) => `{${k}, ${v}}`).join(", ")}})`;
  }
  if (!value.has(3)) throw new Error("MIL value has no contents");
  return `${kind}(${immediate(value)})`;
}
function attrsText(attrs: Map<string, Bytes>, modern = false): string {
  return attrs.size
    ? `[${keys(attrs)
        .map((k) => `${k} = ${valueText(new Message(attrs.get(k)), modern)}`)
        .join(", ")}]`
    : "";
}
export function programText(
  program: Message,
  specificationVersion = 6,
): string {
  if (program.int(1) !== 1) throw new Error("Unsupported MIL program version");
  const modern = specificationVersion >= 9;
  const attrs = program.map(4),
    build = new Map();
  if (attrs.has("buildInfo")) {
    for (const e of new Message(attrs.get("buildInfo"))
      .child(3)
      .child(4)
      .children(1))
      build.set(
        e.child(1).child(3).child(1).child(4).text(1),
        e.child(2).child(3).child(1).child(4).text(1),
      );
    attrs.delete("buildInfo");
  }
  build.set("coremlc-component-MIL", "3510.2.1");
  build.set("coremlc-version", referenceVersion);
  const parts = new Map([
    [
      "buildInfo",
      `buildInfo = ${modern ? "dict<string, string>" : "dict<tensor<string, []>, tensor<string, []>>"}({${keys(
        build,
      )
        .map((k) => `{${quote(k)}, ${quote(build.get(k))}}`)
        .join(", ")}})`,
    ],
  ]);
  for (const [k, v] of attrs)
    parts.set(k, `${k} = ${valueText(new Message(v), modern)}`);
  const lines = [
    modern ? "program(1.3)" : "program(1.0)",
    `[${keys(parts)
      .map((k) => parts.get(k))
      .join(", ")}]`,
    "{",
  ];
  const functions = program.map(2);
  if (functions.size !== 1)
    throw new Error("Only single-function ML Programs are supported");
  for (const name of keys(functions)) {
    if (!/^[A-Za-z_][A-Za-z0-9_@]*$/.test(name))
      throw new Error("Invalid function name");
    const fn = new Message(functions.get(name));
    if (fn.map(4).size)
      throw new Error("Function attributes are not supported yet");
    const blocks = fn.map(3),
      target = opsets.get(fn.text(2));
    if (!target || blocks.size !== 1 || !blocks.has(fn.text(2)))
      throw new Error("Unsupported MIL specialization");
    const block = new Message(blocks.get(fn.text(2)));
    if (block.map(4).size || block.has(1))
      throw new Error("Block inputs and attributes are not supported yet");
    lines.push(
      `    func ${name}<${target}>(${fn
        .children(1)
        .map((n) => named(n, modern))
        .join(", ")}) {`,
    );
    for (const op of block.children(3)) {
      if (!supported.has(op.text(1)))
        throw new Error(`Unsupported MIL operation ${op.text(1)}`);
      if (op.has(4)) throw new Error("Control flow is not supported yet");
      const params = op.map(2),
        args = [];
      for (const param of keys(params)) {
        const vals = new Message(params.get(param))
          .children(1)
          .map((b) => (b.has(1) ? b.text(1) : valueText(b.child(2), modern)));
        args.push(
          `${param} = ${vals.length === 1 ? vals[0] : `(${vals.join(", ")})`}`,
        );
      }
      lines.push(
        `            ${op
          .children(3)
          .map((n) => named(n, modern))
          .join(
            ", ",
          )} = ${op.text(1)}(${args.join(", ")})${attrsText(op.map(5), modern)};`,
      );
    }
    lines.push(
      `        } -> (${block
        .all(2)
        .map((b) => b.toString("utf8"))
        .join(", ")});`,
    );
  }
  lines.push("}");
  return lines.join("\n");
}
