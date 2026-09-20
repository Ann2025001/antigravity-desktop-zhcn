import { readFileFromAsar, readJsonFromAsar } from "./asar-reader.mjs";
import { sha256Buffer, sha256File } from "./hash.mjs";

export function buildCompatibilityCandidate({
  appVersion,
  appAsarSha256,
  customSchemePath,
  customSchemeBuffer,
  uiBundle,
  platform = process.platform,
  arch = process.arch,
  collectedAt = new Date().toISOString(),
}) {
  if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(appVersion)) {
    throw new Error(`无法识别客户端版本：${appVersion}`);
  }
  if (!Buffer.isBuffer(customSchemeBuffer) || !Buffer.isBuffer(uiBundle)) {
    throw new TypeError("版本候选需要 customScheme 和运行时 UI 的二进制内容。");
  }

  return {
    platform,
    arch,
    appVersion,
    packageVersion: appVersion,
    appAsarSha256,
    customSchemePath,
    customSchemeSha256: sha256Buffer(customSchemeBuffer),
    uiBundleSha256: sha256Buffer(uiBundle),
    uiBundleSize: uiBundle.length,
    notes:
      `UNVERIFIED candidate collected locally at ${collectedAt}; ` +
      "requires preview, launch, restore, and update-boundary verification.",
  };
}

export async function collectCompatibilityCandidate({
  appAsarPath,
  uiBundle,
  customSchemePath = "dist/customScheme.js",
  platform = process.platform,
  arch = process.arch,
  collectedAt = new Date().toISOString(),
}) {
  const [packageJson, appAsarSha256, customSchemeBuffer] = await Promise.all([
    readJsonFromAsar(appAsarPath, "package.json"),
    sha256File(appAsarPath),
    readFileFromAsar(appAsarPath, customSchemePath),
  ]);

  return buildCompatibilityCandidate({
    appVersion: packageJson.version,
    appAsarSha256,
    customSchemePath,
    customSchemeBuffer,
    uiBundle,
    platform,
    arch,
    collectedAt,
  });
}
