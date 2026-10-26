import { Bytes } from "./bytes.js";
import { modelAvailability, type TargetPlatform } from "./compatibility.js";
import { Message, field, str, keys } from "./proto.js";
import { tensorInfo, quote } from "./mil.js";
export interface FeatureMetadata {
  name: string;
  type: "MultiArray" | "Image";
  shortDescription: string;
  formattedType: string;
  isOptional: string;
  dataType?: string;
  shape?: string;
  hasShapeFlexibility?: string;
  width?: string;
  height?: string;
  colorspace?: string;
  isColor?: string;
  hasSizeFlexibility?: string;
}
export interface PackageMetadata {
  metadataOutputVersion: string;
  specificationVersion: number;
  generatedClassName: string;
  method: string;
  modelType: { name: string };
  inputSchema: FeatureMetadata[];
  outputSchema: FeatureMetadata[];
  stateSchema: FeatureMetadata[];
  modelParameters: unknown[];
  mlProgramOperationTypeHistogram: Record<string, number>;
  computePrecision: string;
  storagePrecision?: string;
  isUpdatable: string;
  availability: Record<TargetPlatform, string>;
  userDefinedMetadata: Record<string, string>;
  shortDescription?: string;
  version?: string;
  author?: string;
  license?: string;
}
function plainValue(value: any): any {
  if (value instanceof Map)
    return Object.fromEntries(
      [...value].map(([key, item]) => [key, plainValue(item)]),
    );
  if (Array.isArray(value)) return value.map(plainValue);
  return value;
}
export function metadataObject(model: Message, name: string): PackageMetadata {
  return plainValue(metadata(model, name));
}
const obj = (...args: any[]): Map<string, any> =>
  new Map(
    Array.from({ length: args.length / 2 }, (_, i) => [
      args[i * 2],
      args[i * 2 + 1],
    ]),
  );
const mask = (1n << 64n) - 1n;
function stringHash(s: string): bigint {
  const units = [];
  for (let i = 0; i < s.length; i++) units.push(s.charCodeAt(i));
  const n = units.length;
  let a = units,
    r = BigInt(n);
  if (n > 96)
    a = [
      ...units.slice(0, 32),
      ...units.slice((n >> 1) - 16, (n >> 1) + 16),
      ...units.slice(-32),
    ];
  let i = 0;
  for (; i + 4 <= a.length; i += 4)
    r =
      (r * 67503105n +
        BigInt(a[i]) * 16974593n +
        BigInt(a[i + 1]) * 66049n +
        BigInt(a[i + 2]) * 257n +
        BigInt(a[i + 3])) &
      mask;
  for (; i < a.length; i++) r = (r * 257n + BigInt(a[i])) & mask;
  return (r + (r << BigInt(n & 31))) & mask;
}
function dictionaryOrder(order: string[]): string[] {
  const sizes = [3, 7, 13, 23, 41, 71, 127, 191, 251, 383, 631, 1087],
    caps = [3, 6, 11, 19, 32, 52, 89, 118, 155, 237, 390, 672];
  let slots: string[] = [],
    size = 0,
    used = 0;
  const put = (k: string) => {
    let i = Number(stringHash(k) % BigInt(slots.length));
    while (slots[i]) i = (i + 1) % slots.length;
    slots[i] = k;
  };
  for (const key of order) {
    if (!key) continue;
    if (!size || used + 1 > caps[size - 1]) {
      if (size >= sizes.length) return order;
      const old = slots;
      slots = Array(sizes[size++]).fill("");
      for (const k of old) if (k) put(k);
    }
    put(key);
    used++;
  }
  return slots.filter(Boolean);
}
const orderedMap = (map: Map<string, any>, order: string[]) =>
  new Map(dictionaryOrder(order).map((k) => [k, map.get(k)]));
export function appleJSON(v: any, level = 0): string {
  if (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    !(v instanceof Map)
  )
    v = new Map(Object.entries(v));
  const pad = "  ".repeat(level),
    next = "  ".repeat(level + 1);
  if (v instanceof Map)
    return (
      "{\n" +
      [...v]
        .map(([k, x]) => next + quote(k) + " : " + appleJSON(x, level + 1))
        .join(",\n") +
      "\n" +
      pad +
      "}"
    );
  if (Array.isArray(v))
    return (
      "[\n" +
      v.map((x) => next + appleJSON(x, level + 1)).join(",\n") +
      "\n" +
      pad +
      "]"
    );
  return JSON.stringify(v).replaceAll("/", "\\/");
}
function feature(f: Message): Map<string, any> {
  const name = f.text(1),
    description = f.text(2),
    t = f.child(3),
    optional = String(t.int(1000));
  if (t.has(5)) {
    const a = t.child(5);
    if (a.has(21) || a.has(31))
      throw new Error("Flexible feature shapes are not supported yet");
    const shape = a.packed(1).map(Number),
      dtype = new Map([
        [65552, "Float16"],
        [65568, "Float32"],
        [65600, "Double"],
        [131104, "Int32"],
        [131080, "Int8"],
      ]).get(a.int(2));
    if (!dtype) throw new Error("Unsupported multiarray feature type");
    return obj(
      "hasShapeFlexibility",
      "0",
      "isOptional",
      optional,
      "dataType",
      dtype,
      "formattedType",
      `MultiArray (${dtype} ${shape.join(" × ")})`,
      "shortDescription",
      description,
      "shape",
      `[${shape.join(", ")}]`,
      "name",
      name,
      "type",
      "MultiArray",
    );
  }
  if (t.has(4)) {
    const a = t.child(4);
    if (a.has(21) || a.has(31))
      throw new Error("Flexible image sizes are not supported yet");
    const width = String(a.int(1)),
      height = String(a.int(2));
    let color = "RGB",
      isColor = "1",
      label = "Color";
    switch (a.int(3)) {
      case 10:
        color = "Grayscale";
        isColor = "0";
        label = "Grayscale";
        break;
      case 20:
        break;
      case 30:
        color = "BGR";
        break;
      default:
        throw new Error("Unsupported image color space");
    }
    return obj(
      "height",
      height,
      "colorspace",
      color,
      "isOptional",
      optional,
      "width",
      width,
      "isColor",
      isColor,
      "formattedType",
      `Image (${label} ${width} × ${height})`,
      "hasSizeFlexibility",
      "0",
      "type",
      "Image",
      "shortDescription",
      description,
      "name",
      name,
    );
  }
  throw new Error(`Unsupported ML Program feature ${name}`);
}
const overridden = new Set(
  `abs acos add asin atan avg_pool batch_norm cast ceil clip conv conv_transpose cos cosh elu erf exp exp2 floor floor_div gather gelu instance_norm inverse l2_pool layer_norm leaky_relu linear log matmul max_pool maximum minimum mod mul pow prelu real_div reduce_argmax reduce_argmin reduce_l1_norm reduce_l2_norm reduce_log_sum reduce_log_sum_exp reduce_max reduce_mean reduce_min reduce_prod reduce_sum reduce_sum_square relu reshape round rsqrt sigmoid sign sin sinh softmax softplus softsign sqrt square sub tan tanh upsample_bilinear`.split(
    /\s+/,
  ),
);
const operationRevisions = [
  [
    7,
    new Set(
      `abs acos add asin atan cast ceil clip concat conv conv_transpose cos cosh elu exp exp2 expand_dims floor floor_div inverse leaky_relu linear log matmul maximum minimum mod mul pow real_div reduce_argmax reduce_argmin reshape round rsqrt sign sin sinh slice_by_index sqrt square squeeze sub tan tanh transpose`.split(
        /\s+/,
      ),
    ),
  ],
  [
    8,
    new Set(
      `abs acos add asin atan avg_pool cast ceil clip concat conv conv_transpose cos cosh elu erf exp exp2 expand_dims floor floor_div gelu inverse l2_pool leaky_relu linear log matmul max_pool maximum minimum mod mul pow real_div reduce_argmax reduce_argmin relu reshape round rsqrt sigmoid sign sin sinh slice_by_index softmax softplus softsign sqrt square squeeze sub tan tanh transpose`.split(
        /\s+/,
      ),
    ),
  ],
  [
    9,
    new Set(
      `add concat expand_dims floor_div maximum minimum mod mul pow real_div reshape slice_by_index squeeze stack sub transpose`.split(
        /\s+/,
      ),
    ),
  ],
] as const;
function displayOp(name: string, opset: string): string {
  let s = name
    .split("_")
    .map((x) => x[0].toUpperCase() + x.slice(1))
    .join("");
  const version = Number(opset.slice("CoreML".length));
  let revision = version >= 6 && overridden.has(name) ? 6 : 0;
  for (const [minimum, operations] of operationRevisions)
    if (version >= minimum && operations.has(name)) revision = minimum;
  if (revision) s = `Ios${revision + 10}.` + s[0].toLowerCase() + s.slice(1);
  return s;
}
function precision(names: Set<string>): string {
  const labels = new Map([
    ["fp16", "Float16"],
    ["fp32", "Float32"],
    ["fp64", "Double"],
    ["int8", "Int8"],
    ["int16", "Int16"],
    ["int32", "Int32"],
    ["int64", "Int64"],
    ["uint8", "UInt8"],
    ["uint16", "UInt16"],
    ["uint32", "UInt32"],
    ["uint64", "UInt64"],
  ]);
  const parts = [...labels].filter(([k]) => names.has(k)).map(([, v]) => v);
  return parts.length === 1 ? parts[0] : `Mixed (${parts.join(", ")})`;
}
function className(s: string): string {
  let result = s.replace(/[^A-Za-z0-9_]/g, "_");
  if (/^[0-9]/.test(result)) result = "_" + result;
  return result || "Model";
}
export function metadata(model: Message, name: string): Map<string, any> {
  const desc = model.child(2),
    meta = desc.child(100),
    program = model.child(502),
    hist = new Map(),
    computes = new Set<string>(),
    storage = new Set<string>();
  for (const raw of program.map(2).values()) {
    const fn = new Message(raw),
      block = new Message(fn.map(3).get(fn.text(2)));
    for (const op of block.children(3)) {
      for (const out of op.children(3)) {
        const [dtype] = tensorInfo(out.child(2));
        if (!["bool", "string"].includes(dtype)) computes.add(dtype);
        if (
          op.text(1) === "const" &&
          new Message(op.map(5).get("val")).has(5) &&
          ["fp16", "fp32", "fp64"].includes(dtype)
        )
          storage.add(dtype);
      }
      if (op.text(1) === "const") continue;
      const key = displayOp(op.text(1), fn.text(2));
      hist.set(key, (hist.get(key) || 0) + 1);
    }
  }
  const inputs = desc.children(1).map(feature),
    outputs = desc.children(10).map(feature),
    version = model.int(1),
    avail = modelAvailability(version);
  const user = new Map(meta.children(100).map((e) => [e.text(1), e.text(2)]));
  const values = obj(
    "metadataOutputVersion",
    "3.0",
    "outputSchema",
    outputs,
    "modelParameters",
    [],
    "specificationVersion",
    version,
    "mlProgramOperationTypeHistogram",
    orderedMap(hist, [...hist.keys()]),
    "computePrecision",
    precision(computes),
    "isUpdatable",
    String(model.int(10)),
    "stateSchema",
    [],
    "availability",
    obj(
      "macOS",
      avail.macOS,
      "tvOS",
      avail.tvOS,
      "visionOS",
      avail.visionOS,
      "watchOS",
      avail.watchOS,
      "iOS",
      avail.iOS,
      "macCatalyst",
      avail.macCatalyst,
    ),
    "modelType",
    obj("name", "MLModelType_mlProgram"),
    "userDefinedMetadata",
    orderedMap(user, [...user.keys()]),
    "inputSchema",
    inputs,
    "generatedClassName",
    className(name),
    "method",
    "predict",
  );
  if (storage.size) values.set("storagePrecision", precision(storage));
  for (const [n, k] of [
    [1, "shortDescription"],
    [2, "version"],
    [3, "author"],
    [4, "license"],
  ] as const)
    if (meta.text(n)) values.set(k, meta.text(n));
  let order =
    "metadataOutputVersion storagePrecision outputSchema modelParameters specificationVersion mlProgramOperationTypeHistogram computePrecision isUpdatable stateSchema availability modelType userDefinedMetadata inputSchema generatedClassName method";
  if ([1, 2, 3, 4].some((n) => meta.text(n)))
    order =
      "shortDescription metadataOutputVersion outputSchema version modelParameters author specificationVersion storagePrecision license mlProgramOperationTypeHistogram computePrecision stateSchema isUpdatable availability modelType inputSchema userDefinedMetadata generatedClassName method";
  return new Map(
    order
      .split(" ")
      .filter((k) => values.has(k))
      .map((k) => [k, values.get(k)]),
  );
}
export function canonicalDescription(desc: Message): Message {
  const meta = desc.child(100),
    regular = meta.fields.filter((f) => f.number !== 100),
    entries = new Map(meta.children(100).map((e) => [e.text(1), e.encode()]));
  regular.sort((a, b) => a.number - b.number);
  const parts = regular.map((f) => field(f.number, f.value, f.wire));
  for (const k of keys(entries)) parts.push(field(100, entries.get(k)));
  return desc.set(100, Bytes.concat(parts));
}
export function overlayDescription(
  model: Message,
  metadataJSON?: string,
  featuresJSON?: string,
): Message {
  let desc = model.child(2);
  if (metadataJSON) {
    const overlay = JSON.parse(metadataJSON);
    let meta = desc.child(100);
    for (const [k, n] of Object.entries({
      MLModelDescriptionKey: 1,
      MLModelVersionStringKey: 2,
      MLModelAuthorKey: 3,
      MLModelLicenseKey: 4,
    })) {
      if (Object.hasOwn(overlay, k)) {
        if (typeof overlay[k] !== "string")
          throw new Error("Metadata overlay values must be strings");
        meta = meta.set(n, Bytes.from(overlay[k]));
      }
    }
    if (Object.hasOwn(overlay, "MLModelCreatorDefinedKey")) {
      const values = overlay.MLModelCreatorDefinedKey;
      if (!values || Array.isArray(values) || typeof values !== "object")
        throw new Error("Invalid creator metadata");
      for (const key of Object.keys(values).sort()) {
        if (typeof values[key] !== "string")
          throw new Error("Creator metadata values must be strings");
        meta.fields = meta.fields.filter(
          (f) => f.number !== 100 || new Message(f.value).text(1) !== key,
        );
        meta.fields.push({
          number: 100,
          wire: 2,
          value: Bytes.concat([str(1, key), str(2, values[key])]),
        });
      }
    }
    desc = desc.set(100, meta.encode());
  }
  if (featuresJSON) {
    const overlay = JSON.parse(featuresJSON);
    for (const [section, n] of Object.entries({
      Inputs: 1,
      Outputs: 10,
      States: 13,
      TrainingInputs: 50,
    })) {
      if (!Object.hasOwn(overlay, section)) continue;
      const entries = overlay[section];
      desc.fields = desc.fields.map((f) => {
        if (f.number !== n) return f;
        let feature = new Message(f.value);
        const data = entries[feature.text(1)];
        if (data && Object.hasOwn(data, "MLFeatureShortDescription")) {
          if (typeof data.MLFeatureShortDescription !== "string")
            throw new Error("Invalid feature overlay");
          feature = feature.set(2, Bytes.from(data.MLFeatureShortDescription));
        }
        return { ...f, value: feature.encode() };
      });
    }
  }
  return model.set(2, desc.encode());
}
