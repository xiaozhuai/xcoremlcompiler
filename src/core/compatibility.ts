export const targetPlatforms = [
  "macOS",
  "iOS",
  "watchOS",
  "tvOS",
  "macCatalyst",
  "visionOS",
] as const;
export type TargetPlatform = (typeof targetPlatforms)[number];
export interface CompileWarning {
  code: "incomplete-deployment-target" | "unsupported-deployment-target";
  message: string;
}
export interface DeploymentOptions {
  platform?: TargetPlatform;
  deploymentTarget?: string;
  onWarning?: (warning: CompileWarning) => void;
}

// Availability values emitted by the pinned Apple compiler (3500.32.1).
// Its spec 10 output still uses the pre-26 OS version numbering.
export function modelAvailability(
  version: number,
): Record<TargetPlatform, string> {
  const versions = new Map([
    [6, ["12.0", "15.0", "8.0", "1.0"]],
    [7, ["13.0", "16.0", "9.0", "1.0"]],
    [8, ["14.0", "17.0", "10.0", "1.0"]],
    [9, ["15.0", "18.0", "11.0", "2.0"]],
    [10, ["16.0", "19.0", "12.0", "3.0"]],
  ]).get(version);
  if (!versions) throw new Error("Unsupported specification version");
  return {
    macOS: versions[0],
    iOS: versions[1],
    watchOS: versions[2],
    tvOS: versions[1],
    macCatalyst: versions[1],
    visionOS: versions[3],
  };
}
export function normalizePlatform(value: string): TargetPlatform {
  const platform = targetPlatforms.find(
    (p) => p.toLowerCase() === value.toLowerCase(),
  );
  if (platform) return platform;
  if (value.toLowerCase() === "xros") return "visionOS";
  throw new Error(`Unsupported target platform: ${value}`);
}
function versionParts(value: string): number[] {
  if (!/^\d+(?:\.\d+){0,2}$/.test(value))
    throw new Error(
      "deploymentTarget must be a version such as 18, 18.0 or 18.0.1",
    );
  const parts = value.split(".").map(Number);
  if (parts.some((p) => !Number.isSafeInteger(p)))
    throw new Error("Deployment target version is out of range");
  while (parts.length < 3) parts.push(0);
  return parts;
}
export function checkDeploymentTarget(
  version: number,
  options: DeploymentOptions,
): void {
  const availability = modelAvailability(version);
  const platform =
    options.platform === undefined
      ? undefined
      : normalizePlatform(options.platform);
  const target =
    options.deploymentTarget === undefined
      ? undefined
      : versionParts(options.deploymentTarget);
  if (!platform && !target) return;
  if (!platform || !target) {
    options.onWarning?.({
      code: "incomplete-deployment-target",
      message: "both --platform AND --deployment-target must be provided",
    });
    return;
  }
  const minimum = availability[platform],
    required = versionParts(minimum);
  for (let i = 0; i < 3; i++) {
    if (target[i] > required[i]) return;
    if (target[i] < required[i]) {
      options.onWarning?.({
        code: "unsupported-deployment-target",
        message: `This model is not supported on specified deployment target of ${options.platform} ${options.deploymentTarget}. It requires ${minimum} or greater`,
      });
      return;
    }
  }
}
