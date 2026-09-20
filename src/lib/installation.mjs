import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { readFileFromAsar, readJsonFromAsar } from "./asar-reader.mjs";
import { sha256Buffer, sha256File } from "./hash.mjs";
import { projectRoot, resolveInstallRoot } from "./paths.mjs";

export async function loadCompatibilityManifest({
  rootDirectory = path.join(projectRoot, "config", "compatibility"),
} = {}) {
  const rootEntries = await readdir(rootDirectory, { withFileTypes: true });
  const versionDirectories = rootEntries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) =>
      right.name.localeCompare(left.name, undefined, { numeric: true }),
    );
  if (versionDirectories.length === 0) {
    throw new Error("兼容性配置目录中没有版本。");
  }

  const targets = [];
  for (const versionDirectory of versionDirectories) {
    if (!/^\d+\.\d+\.\d+$/.test(versionDirectory.name)) {
      throw new Error(`兼容性版本目录名称无效：${versionDirectory.name}`);
    }

    const directoryPath = path.join(rootDirectory, versionDirectory.name);
    const shardFiles = (await readdir(directoryPath, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .sort((left, right) => left.name.localeCompare(right.name));
    if (shardFiles.length === 0) {
      throw new Error(`兼容性版本目录没有 JSON 配置：${versionDirectory.name}`);
    }

    for (const shardFile of shardFiles) {
      const filePath = path.join(directoryPath, shardFile.name);
      let shard;
      try {
        shard = JSON.parse(await readFile(filePath, "utf8"));
      } catch (error) {
        throw new Error(`兼容性配置无法读取：${filePath}`, { cause: error });
      }
      if (
        shard.schemaVersion !== 1 ||
        shard.appVersion !== versionDirectory.name ||
        !Array.isArray(shard.targets) ||
        shard.targets.length === 0 ||
        shard.targets.some(
          (target) => target.appVersion !== versionDirectory.name,
        )
      ) {
        throw new Error(`兼容性配置格式无效：${filePath}`);
      }
      targets.push(...shard.targets);
    }
  }

  return { schemaVersion: 1, targets };
}

export async function loadEffectiveCompatibilityManifest(options = {}) {
  const localManifest = await loadCompatibilityManifest();
  const { loadEffectiveCompatibilityManifest: loadRemoteManifest } =
    await import("./remote-compatibility.mjs");
  return loadRemoteManifest({ localManifest, ...options });
}

export function getVersionTargets(
  targets,
  { platform, arch, appVersion },
) {
  return targets.filter(
    (target) =>
      target.platform === platform &&
      target.arch === arch &&
      target.appVersion === appVersion,
  );
}

export function findCompatibilityTarget(
  versionTargets,
  { appAsarSha256, customSchemes },
) {
  return (
    versionTargets.find(
      (candidate) =>
        candidate.appAsarSha256 === appAsarSha256 &&
        customSchemes[candidate.customSchemePath]?.sha256 ===
          candidate.customSchemeSha256,
    ) ?? null
  );
}

export function classifyLocalizedBundleInstall({
  existingHash,
  expectedHash,
  replaceableHash = null,
}) {
  if (existingHash === expectedHash) return "reuse";
  if (existingHash === null) return "create";
  if (replaceableHash && existingHash === replaceableHash) return "replace";
  return "reject";
}

export async function inspectInstallation({ allowRemoteCompatibility = true } = {}) {
  const {
    installRoot,
    source: installRootSource,
    sourceLabel: installRootSourceLabel,
  } = await resolveInstallRoot();
  const executablePath = path.join(installRoot, "Antigravity.exe");
  const appAsarPath = path.join(installRoot, "resources", "app.asar");

  await access(executablePath, constants.R_OK);
  await access(appAsarPath, constants.R_OK);

  const packageJson = await readJsonFromAsar(appAsarPath, "package.json");
  const manifest = allowRemoteCompatibility
    ? await loadEffectiveCompatibilityManifest()
    : await loadCompatibilityManifest();
  const versionTargets = getVersionTargets(manifest.targets, {
    platform: process.platform,
    arch: process.arch,
    appVersion: packageJson.version,
  });
  const supportedVersions = [
    ...new Set(
      manifest.targets
        .filter(
          (target) =>
            target.platform === process.platform &&
            target.arch === process.arch,
        )
        .map((target) => target.appVersion),
    ),
  ].sort((left, right) =>
    right.localeCompare(left, undefined, { numeric: true }),
  );

  const appAsarSha256 = await sha256File(appAsarPath);
  const customSchemePaths = [
    ...new Set(versionTargets.map((target) => target.customSchemePath)),
  ];
  const customSchemes = {};
  for (const customSchemePath of customSchemePaths) {
    try {
      const buffer = await readFileFromAsar(appAsarPath, customSchemePath);
      customSchemes[customSchemePath] = {
        buffer,
        sha256: sha256Buffer(buffer),
      };
    } catch {
      // Different official builds of one version may use different entry paths.
      customSchemes[customSchemePath] = null;
    }
  }

  const target = findCompatibilityTarget(versionTargets, {
    appAsarSha256,
    customSchemes,
  });

  return {
    installRoot,
    installRootSource,
    installRootSourceLabel,
    executablePath,
    appAsarPath,
    packageVersion: packageJson.version,
    appAsarSha256,
    customSchemes,
    target,
    versionKnown: versionTargets.length > 0,
    compatibleBuildCount: versionTargets.length,
    supportedVersions,
    remoteCompatibility: manifest.remote ?? { status: "local-only" },
  };
}
