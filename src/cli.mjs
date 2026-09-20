import {
  copyFile,
  mkdir,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import os from "node:os";
import {
  classifyLocalizedBundleInstall,
  inspectInstallation,
  loadEffectiveCompatibilityManifest,
} from "./lib/installation.mjs";
import {
  fetchUiBundle,
  findLatestUiPort,
  inspectUiBundle,
  loadCompatibleUiBundle,
  waitForCompatibleUiBundle,
} from "./lib/runtime-bundle.mjs";
import {
  createLocalizedBundle,
  loadDomTranslations,
  writeLocalizedBundle,
} from "./lib/translator.mjs";
import {
  atomicReplaceFile,
  buildPatchedAsar,
} from "./lib/patcher.mjs";
import {
  areSamePaths,
  getAntigravityUserDataRoot,
  getRuntimePreviewRoot,
  getStateRoot,
} from "./lib/paths.mjs";
import { sha256File } from "./lib/hash.mjs";
import {
  isAntigravityRunning,
  launchAntigravity,
  waitForAntigravityExit,
} from "./lib/processes.mjs";
import { readInstallState, writeInstallState } from "./lib/state.mjs";
import {
  determinePurgeInstallAction,
  formatBytes,
  inspectCleanupTargets,
  inspectPurgeTargets,
  removeCleanupTargets,
} from "./lib/cleanup.mjs";
import {
  getErrorAdvice,
  LATEST_RELEASE_URL,
  writeDiagnosticLog,
} from "./lib/diagnostics.mjs";

const INSTALLED_BUNDLE_NAME = "agy_zhcn_ui_main.js";

function printStep(current, total, message) {
  console.log(`\n[${current}/${total}] ${message}`);
}

function printStaticReport(inspection) {
  console.log(`安装目录: ${inspection.installRoot}`);
  console.log(`路径来源: ${inspection.installRootSourceLabel}`);
  console.log(`客户端版本: ${inspection.packageVersion}`);
  console.log(`app.asar SHA256: ${inspection.appAsarSha256}`);
  const remote = inspection.remoteCompatibility;
  if (remote?.status === "verified-network") {
    console.log(`兼容清单: 远程签名清单（序号 ${remote.sequence}）`);
  } else if (remote?.status === "verified-cache") {
    console.log(`兼容清单: 已验证远程缓存（序号 ${remote.sequence}）`);
  } else if (remote?.status === "local-fallback") {
    console.log("兼容清单: 内置白名单（远程不可用或验证失败）");
  } else {
    console.log("兼容清单: 内置白名单");
  }

  if (inspection.target) {
    const custom = inspection.customSchemes[inspection.target.customSchemePath];
    console.log(`customScheme SHA256: ${custom.sha256}`);
    console.log("静态兼容性: 通过");
  } else if (inspection.versionKnown) {
    console.log(
      `静态兼容性: 失败（版本已登记 ${inspection.compatibleBuildCount} 个构建，但安装文件指纹不同）`,
    );
    console.log(`请先检查最新版: ${LATEST_RELEASE_URL}`);
  } else {
    console.log("静态兼容性: 失败（当前版本尚未登记）");
    console.log(`本工具已登记版本: ${inspection.supportedVersions.join("、")}`);
    console.log(`请先检查最新版: ${LATEST_RELEASE_URL}`);
  }
}

async function check() {
  const inspection = await inspectInstallation();
  printStaticReport(inspection);

  const running = await isAntigravityRunning();
  console.log(`客户端状态: ${running ? "正在运行" : "未运行"}`);
  if (!inspection.target || !running) {
    if (!running) {
      console.log("运行时 UI: 未检查；打开 Antigravity 后可再次检查。");
    }
    return inspection.target ? 0 : 2;
  }

  const port = await findLatestUiPort();
  if (!port) {
    console.log("运行时 UI: 未找到本地端口");
    return 2;
  }
  const buffer = await fetchUiBundle(port);
  const runtime = inspectUiBundle(buffer);
  console.log(`运行时 UI SHA256: ${runtime.sha256}`);
  console.log(`运行时 UI 大小: ${runtime.size} bytes`);
  const compatible =
    runtime.sha256 === inspection.target.uiBundleSha256 &&
    runtime.size === inspection.target.uiBundleSize;
  console.log(`完整兼容性: ${compatible ? "通过" : "失败"}`);
  return compatible ? 0 : 2;
}

function assertSyntax(filePath) {
  const result = spawnSync(process.execPath, ["--check", filePath], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`生成文件语法检查失败：${result.stderr || result.stdout}`);
  }
}

async function generateLocalizedPreview(
  inspection,
  outputPath,
  { resolvedUi = null } = {},
) {
  if (!inspection.target) {
    throw new Error("当前安装文件未通过兼容性检查，拒绝生成。");
  }

  const resolved =
    resolvedUi ?? (await loadCompatibleUiBundle(inspection.target));
  const dictionary = await loadDomTranslations();
  const localized = createLocalizedBundle(resolved.buffer, dictionary);
  await writeLocalizedBundle(outputPath, localized.buffer);
  assertSyntax(outputPath);

  console.log(`UI 来源: ${resolved.source}`);
  console.log(
    `词典可发现项: ${localized.coverage.hits}/${localized.coverage.total}`,
  );
  console.log(`生成文件 SHA256: ${localized.sha256}`);
  console.log(`生成文件: ${outputPath}`);
  return {
    ...localized,
    sourceBundleSha256: inspection.target.uiBundleSha256,
    sourceBundlePath: resolved.path,
  };
}

async function preview() {
  const inspection = await inspectInstallation();
  printStaticReport(inspection);
  const outputPath = path.join(
    getRuntimePreviewRoot(),
    inspection.packageVersion,
    "zh_cn_ui_main.js",
  );
  await generateLocalizedPreview(inspection, outputPath);
  console.log("预览生成完成；未修改 Antigravity 安装目录。");
  return 0;
}

async function askForConfirmation(message, { assumeYes = false } = {}) {
  if (assumeYes) return true;
  if (!input.isTTY) {
    throw new Error(`当前环境无法交互确认；确认风险后可添加 --yes。${message}`);
  }

  const readline = createInterface({ input, output });
  try {
    const answer = (await readline.question(`${message} [y/N] `))
      .trim()
      .toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    readline.close();
  }
}

async function prepareRuntimeUi(inspection) {
  try {
    return await loadCompatibleUiBundle(inspection.target, {
      allowLiveFetch: false,
    });
  } catch {
    // 没有有效缓存时，下面启动或等待真实客户端提供 UI。
  }

  if (!(await isAntigravityRunning())) {
    console.log("Antigravity 当前未运行，正在自动打开客户端...");
    await launchAntigravity(inspection.executablePath);
  } else {
    console.log("Antigravity 正在运行，等待主界面加载...");
  }

  console.log("请保持客户端打开，工具正在读取并验证运行时 UI（最长 2 分钟）。");
  return waitForCompatibleUiBundle(inspection.target);
}

async function askUserToCloseAntigravity(message) {
  if (!(await isAntigravityRunning())) {
    return;
  }
  const readline = createInterface({ input, output });
  try {
    await readline.question(message);
  } finally {
    readline.close();
  }
  await waitForAntigravityExit();
}

async function ensureVerifiedBackup({ sourcePath, backupPath, expectedHash }) {
  await mkdir(path.dirname(backupPath), { recursive: true });
  try {
    const backupHash = await sha256File(backupPath);
    if (backupHash !== expectedHash) {
      throw new Error("现有备份文件哈希异常，拒绝覆盖。");
    }
    return;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const temporaryPath = `${backupPath}.${process.pid}.tmp`;
  await copyFile(sourcePath, temporaryPath);
  const temporaryHash = await sha256File(temporaryPath);
  if (temporaryHash !== expectedHash) {
    await rm(temporaryPath, { force: true });
    throw new Error("原始 ASAR 备份校验失败。");
  }

  try {
    await rename(temporaryPath, backupPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function installLocalizedBundle({
  bundlePath,
  bundle,
  expectedHash,
  replaceableHash = null,
}) {
  await mkdir(path.dirname(bundlePath), { recursive: true });
  const existingHash = await sha256File(bundlePath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });

  const action = classifyLocalizedBundleInstall({
    existingHash,
    expectedHash,
    replaceableHash,
  });
  if (action === "reuse") {
    return { created: false };
  }
  if (action === "reject") {
    throw new Error(`目标中文 UI 文件已存在且哈希未知：${bundlePath}`);
  }

  const temporaryPath = `${bundlePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, bundle, { flag: "wx" });
  const temporaryHash = await sha256File(temporaryPath);
  if (temporaryHash !== expectedHash) {
    await rm(temporaryPath, { force: true });
    throw new Error("中文 UI 暂存文件哈希验证失败。");
  }
  if (action === "create") {
    await rename(temporaryPath, bundlePath);
    return { created: true };
  }

  try {
    const replacement = await atomicReplaceFile({
      currentPath: bundlePath,
      replacementPath: temporaryPath,
      currentExpectedHash: replaceableHash,
      replacementExpectedHash: expectedHash,
    });
    return {
      created: false,
      replaced: true,
      finalize: replacement.finalize,
      rollback: replacement.rollback,
    };
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function findInstalledTarget(state) {
  const manifest = await loadEffectiveCompatibilityManifest();
  return (
    manifest.targets.find(
      (target) =>
        target.platform === process.platform &&
        target.arch === process.arch &&
        target.appVersion === state.appVersion &&
        target.appAsarSha256 === state.originalAsarSha256 &&
        target.customSchemeSha256 === state.originalCustomSchemeSha256,
    ) ?? null
  );
}

async function updateInstalledLocalization({
  existingState,
  initialInspection,
  installedBundleHash,
  assumeYes,
}) {
  const target = await findInstalledTarget(existingState);
  if (!target) {
    throw new Error("现有汉化状态无法对应到兼容性清单，请先恢复英文。");
  }

  printStep(2, 5, "读取原始运行时 UI，生成最新中文文件");
  const preparedBundlePath = path.join(
    getStateRoot(),
    "prepared",
    "zh_cn_ui_main.js",
  );
  const inspectionWithTarget = { ...initialInspection, target };
  const resolvedUi = await prepareRuntimeUi(inspectionWithTarget);
  const localized = await generateLocalizedPreview(
    inspectionWithTarget,
    preparedBundlePath,
    { resolvedUi },
  );

  if (localized.sha256 === installedBundleHash) {
    console.log("当前汉化规则已经是最新版本，无需更新。");
    return 0;
  }

  printStep(3, 5, "等待汉化更新确认");
  console.log("只会更新中文 UI 文件，不会重复修改 app.asar 或原版备份。");
  if (
    !(await askForConfirmation("检测到新的汉化规则，确认更新吗？", {
      assumeYes,
    }))
  ) {
    console.log("已取消；现有汉化保持不变。");
    return 0;
  }

  printStep(4, 5, "确认 Antigravity 已彻底退出并原子更新中文文件");
  await askUserToCloseAntigravity(
    "最新中文文件已生成。请彻底关闭 Antigravity，然后按回车继续更新...",
  );
  const inspection = await inspectInstallation();
  if (
    inspection.appAsarSha256 !== initialInspection.appAsarSha256 ||
    inspection.packageVersion !== initialInspection.packageVersion
  ) {
    throw new Error("等待期间客户端文件发生变化，拒绝更新汉化。");
  }

  const currentBundleHash = await sha256File(existingState.installedBundlePath);
  if (currentBundleHash !== installedBundleHash) {
    throw new Error("等待期间中文 UI 文件发生变化，拒绝更新。");
  }

  let replacement;
  try {
    replacement = await atomicReplaceFile({
      currentPath: existingState.installedBundlePath,
      replacementPath: preparedBundlePath,
      currentExpectedHash: installedBundleHash,
      replacementExpectedHash: localized.sha256,
    });

    printStep(5, 5, "复检更新结果并保存恢复状态");
    const updatedHash = await sha256File(existingState.installedBundlePath);
    if (updatedHash !== localized.sha256) {
      throw new Error("汉化更新后复检失败，正在自动回滚。");
    }
    await writeInstallState({
      ...existingState,
      updatedAt: new Date().toISOString(),
      sourceBundleSha256: localized.sourceBundleSha256,
      localizedBundleSha256: localized.sha256,
    });
    await replacement.finalize().catch((error) => {
      console.warn(`警告：旧中文文件临时副本未能清理：${error.message}`);
    });
  } catch (error) {
    if (replacement) {
      try {
        await replacement.rollback();
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "汉化更新失败，并且自动回滚也失败。请不要启动 Antigravity。",
        );
      }
    }
    throw error;
  }

  console.log("汉化规则更新完成。现在可以重新打开 Antigravity。");
  return 0;
}

async function install({ assumeYes = false } = {}) {
  const existingState = await readInstallState();
  const initialInspection = await inspectInstallation();
  const hasVerifiedInstalledState =
    existingState?.status === "installed" &&
    areSamePaths(existingState.installRoot, initialInspection.installRoot) &&
    existingState.appVersion === initialInspection.packageVersion &&
    existingState.patchedAsarSha256 === initialInspection.appAsarSha256;
  const totalSteps = hasVerifiedInstalledState ? 5 : 7;
  printStep(1, totalSteps, "检查环境、安装目录和客户端指纹");
  if (hasVerifiedInstalledState) {
    const installedBundleHash = await sha256File(
      existingState.installedBundlePath,
    ).catch(() => null);
    if (installedBundleHash === existingState.localizedBundleSha256) {
      return updateInstalledLocalization({
        existingState,
        initialInspection,
        installedBundleHash,
        assumeYes,
      });
    }
    throw new Error(
      "检测到已安装的 ASAR 补丁，但中文 UI 文件缺失或已变化；请先恢复英文。",
    );
  }

  printStaticReport(initialInspection);
  if (!initialInspection.target) {
    throw new Error("当前安装文件不在兼容性白名单中，拒绝安装。");
  }

  printStep(2, totalSteps, "获取并验证运行时 UI，生成中文文件");
  const stateRoot = getStateRoot();
  const preparedBundlePath = path.join(stateRoot, "prepared", "zh_cn_ui_main.js");
  const resolvedUi = await prepareRuntimeUi(initialInspection);
  const localized = await generateLocalizedPreview(
    initialInspection,
    preparedBundlePath,
    { resolvedUi },
  );

  const installedBundlePath = path.join(
    getAntigravityUserDataRoot(),
    INSTALLED_BUNDLE_NAME,
  );
  const existingStateTarget =
    existingState?.status === "installed"
      ? await findInstalledTarget(existingState)
      : null;
  const replaceableLocalizedBundleHash =
    existingStateTarget &&
    areSamePaths(existingState.installRoot, initialInspection.installRoot) &&
    existingState.installedBundlePath &&
    areSamePaths(existingState.installedBundlePath, installedBundlePath)
      ? existingState.localizedBundleSha256
      : null;
  const existingLocalizedBundleHash = await sha256File(
    installedBundlePath,
  ).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  const localizedBundleAction = classifyLocalizedBundleInstall({
    existingHash: existingLocalizedBundleHash,
    expectedHash: localized.sha256,
    replaceableHash: replaceableLocalizedBundleHash,
  });
  if (localizedBundleAction === "reject") {
    throw new Error(
      `目标中文 UI 文件已存在且哈希未知：${installedBundlePath}`,
    );
  }

  printStep(3, totalSteps, "等待安装确认");
  console.log("下一步会先创建并验证原始 app.asar 备份，再安装汉化补丁。");
  if (localizedBundleAction === "replace") {
    console.log("检测到由本工具安装的旧版中文 UI；安装时将验证并原子替换。");
  }
  if (
    !(await askForConfirmation("确认继续安装吗？", {
      assumeYes,
    }))
  ) {
    console.log("已取消；未修改 Antigravity 安装目录。");
    return 0;
  }

  printStep(4, totalSteps, "确认 Antigravity 已彻底退出");
  await askUserToCloseAntigravity(
    "已取得运行时 UI。请彻底关闭 Antigravity，然后按回车继续安装...",
  );
  const inspection = await inspectInstallation();
  if (
    inspection.appAsarSha256 !== initialInspection.appAsarSha256 ||
    inspection.packageVersion !== initialInspection.packageVersion
  ) {
    throw new Error("等待期间客户端文件发生变化，拒绝安装。");
  }

  printStep(5, totalSteps, "创建并验证原始文件备份");
  const backupDirectory = path.join(
    stateRoot,
    "backups",
    inspection.packageVersion,
    inspection.appAsarSha256,
  );
  const backupPath = path.join(backupDirectory, "app.asar");
  await ensureVerifiedBackup({
    sourcePath: inspection.appAsarPath,
    backupPath,
    expectedHash: inspection.appAsarSha256,
  });

  const buildDirectory = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(path.join(os.tmpdir(), "antigravity-zhcn-build-")),
  );
  const builtAsarPath = path.join(buildDirectory, "app.asar");
  let replacement;
  let bundleResult;
  let bundleCreatedThisRun = false;

  try {
    printStep(6, totalSteps, "构建并原子安装汉化补丁");
    const built = await buildPatchedAsar({
      sourceAsarPath: inspection.appAsarPath,
      outputAsarPath: builtAsarPath,
      customSchemePath: inspection.target.customSchemePath,
      expectedCustomSchemeSha256: inspection.target.customSchemeSha256,
    });
    if (built.packageVersion !== inspection.packageVersion) {
      throw new Error("构建后的客户端版本信息异常。");
    }

    replacement = await atomicReplaceFile({
      currentPath: inspection.appAsarPath,
      replacementPath: builtAsarPath,
      currentExpectedHash: inspection.appAsarSha256,
      replacementExpectedHash: built.patchedAsarSha256,
    });

    bundleResult = await installLocalizedBundle({
      bundlePath: installedBundlePath,
      bundle: localized.buffer,
      expectedHash: localized.sha256,
      replaceableHash: replaceableLocalizedBundleHash,
    });
    bundleCreatedThisRun = bundleResult.created;

    printStep(7, totalSteps, "复检安装结果并保存恢复状态");
    const [installedAsarHash, installedBundleHash] = await Promise.all([
      sha256File(inspection.appAsarPath),
      sha256File(installedBundlePath),
    ]);
    if (
      installedAsarHash !== built.patchedAsarSha256 ||
      installedBundleHash !== localized.sha256
    ) {
      throw new Error("安装后复检失败，正在自动回滚。");
    }

    await writeInstallState({
      schemaVersion: 1,
      status: "installed",
      appVersion: inspection.packageVersion,
      installedAt: new Date().toISOString(),
      installRoot: inspection.installRoot,
      originalAsarSha256: inspection.appAsarSha256,
      patchedAsarSha256: built.patchedAsarSha256,
      originalCustomSchemeSha256: inspection.target.customSchemeSha256,
      patchedCustomSchemeSha256: built.patchedCustomSchemeSha256,
      sourceBundleSha256: localized.sourceBundleSha256,
      localizedBundleSha256: localized.sha256,
      backupPath,
      installedBundlePath,
    });
    await bundleResult.finalize?.().catch((error) => {
      console.warn(`警告：旧中文文件临时副本未能清理：${error.message}`);
    });
    await replacement.finalize().catch((error) => {
      console.warn(`警告：旧文件临时副本未能清理：${error.message}`);
    });
  } catch (error) {
    const rollbackErrors = [];
    if (bundleResult?.rollback) {
      try {
        await bundleResult.rollback();
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (replacement) {
      try {
        await replacement.rollback();
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (bundleCreatedThisRun) {
      await rm(installedBundlePath, { force: true }).catch(() => {});
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "安装失败，并且自动回滚也失败。请不要启动 Antigravity。",
      );
    }
    throw error;
  } finally {
    await rm(buildDirectory, { recursive: true, force: true });
  }

  console.log("汉化安装完成。现在可以重新打开 Antigravity。");
  return 0;
}

async function cleanup({ assumeYes = false } = {}) {
  const targets = await inspectCleanupTargets();
  if (targets.length === 0) {
    console.log("没有发现可清理的预览、缓存或遗留构建文件。");
    return 0;
  }

  const totalBytes = targets.reduce((total, target) => total + target.bytes, 0);
  console.log("将清理以下可再生成文件：");
  for (const target of targets) {
    console.log(`- ${target.label}: ${formatBytes(target.bytes)} (${target.path})`);
  }
  console.log(`合计: ${formatBytes(totalBytes)}`);
  console.log("原始备份、安装状态、中文词典和客户端文件不会被删除。");

  if (!(await askForConfirmation("确认清理吗？", { assumeYes }))) {
    console.log("已取消清理。");
    return 0;
  }

  const result = await removeCleanupTargets(targets);
  console.log(
    `清理完成：${result.removedCount} 项，共 ${formatBytes(result.removedBytes)}。`,
  );
  return 0;
}

async function inspectVerifiedLocalizedBundle(state) {
  if (!state?.installedBundlePath || !state?.localizedBundleSha256) {
    return null;
  }

  let bundleHash;
  try {
    bundleHash = await sha256File(state.installedBundlePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (bundleHash !== state.localizedBundleSha256) {
    throw new Error(
      `本地中文 UI 文件已被修改，无法安全删除：${state.installedBundlePath}`,
    );
  }

  return {
    path: state.installedBundlePath,
    bytes: (await stat(state.installedBundlePath)).size,
  };
}

async function removeVerifiedLocalizedBundle(state, { strict = false } = {}) {
  try {
    const bundle = await inspectVerifiedLocalizedBundle(state);
    if (bundle) {
      await rm(bundle.path, { force: true });
    }
    return bundle;
  } catch (error) {
    if (strict) throw error;
    console.warn(`警告：${error.message}`);
    return null;
  }
}

async function restore() {
  const state = await readInstallState();
  if (!state || state.status !== "installed") {
    throw new Error("没有找到有效的已安装状态，拒绝恢复。");
  }

  await askUserToCloseAntigravity(
    "请彻底关闭 Antigravity，然后按回车继续恢复英文...",
  );
  const inspection = await inspectInstallation();
  if (
    !areSamePaths(inspection.installRoot, state.installRoot) ||
    inspection.packageVersion !== state.appVersion ||
    inspection.appAsarSha256 !== state.patchedAsarSha256
  ) {
    throw new Error("当前客户端版本或补丁哈希已变化，拒绝跨版本恢复。");
  }

  const backupHash = await sha256File(state.backupPath);
  if (backupHash !== state.originalAsarSha256) {
    throw new Error("原始备份哈希验证失败，拒绝恢复。");
  }

  const replacement = await atomicReplaceFile({
    currentPath: inspection.appAsarPath,
    replacementPath: state.backupPath,
    currentExpectedHash: state.patchedAsarSha256,
    replacementExpectedHash: state.originalAsarSha256,
  });

  try {
    await writeInstallState({
      ...state,
      status: "restored",
      restoredAt: new Date().toISOString(),
    });
  } catch (error) {
    await replacement.rollback();
    throw error;
  }

  await replacement.finalize().catch((error) => {
    console.warn(`警告：旧文件临时副本未能清理：${error.message}`);
  });

  await removeVerifiedLocalizedBundle(state);

  console.log("英文原版恢复完成。");
  return 0;
}

async function purge({ assumeYes = false } = {}) {
  const initialState = await readInstallState();
  const localizedBundle = await inspectVerifiedLocalizedBundle(initialState);
  const targets = await inspectPurgeTargets();
  if (targets.length === 0 && !localizedBundle) {
    console.log("没有发现需要卸载的汉化状态或工具数据。");
    return 0;
  }

  let initialInspection = null;
  let installAction = "none";
  if (initialState?.status === "installed") {
    initialInspection = await inspectInstallation();
    installAction = determinePurgeInstallAction({
      state: initialState,
      inspection: initialInspection,
      sameInstallRoot: areSamePaths(
        initialInspection.installRoot,
        initialState.installRoot,
      ),
    });
  }

  console.log("完全卸载将执行以下操作：");
  if (installAction === "restore") {
    console.log("- 先验证备份并恢复英文原版；");
  } else if (installAction === "already-original") {
    console.log("- 当前客户端已是受支持的官方原版，跳过跨版本恢复；");
  }
  for (const target of targets) {
    console.log(`- 永久删除 ${target.label}: ${formatBytes(target.bytes)} (${target.path})`);
  }
  if (localizedBundle) {
    console.log(
      `- 删除已验证的中文 UI: ${formatBytes(localizedBundle.bytes)} (${localizedBundle.path})`,
    );
  }
  console.log("不会删除 Antigravity 用户数据，也不会自动删除当前工具文件夹。");
  console.log("警告：原版备份和恢复记录删除后无法找回。");

  if (
    !(await askForConfirmation("确认完全卸载并永久清除以上数据吗？", {
      assumeYes,
    }))
  ) {
    console.log("已取消完全卸载。");
    return 0;
  }

  if (installAction === "restore") {
    await restore();
  } else if (installAction === "already-original") {
    const currentInspection = await inspectInstallation();
    const currentAction = determinePurgeInstallAction({
      state: initialState,
      inspection: currentInspection,
      sameInstallRoot: areSamePaths(
        currentInspection.installRoot,
        initialState.installRoot,
      ),
    });
    if (
      currentAction !== "already-original" ||
      currentInspection.packageVersion !== initialInspection.packageVersion ||
      currentInspection.appAsarSha256 !== initialInspection.appAsarSha256
    ) {
      throw new Error("确认后客户端文件发生变化，拒绝继续完全卸载。");
    }
  }

  await removeVerifiedLocalizedBundle(initialState, { strict: true });
  const refreshedTargets = await inspectPurgeTargets();
  const result = await removeCleanupTargets(refreshedTargets);

  const stateRoot = getStateRoot();
  await rmdir(stateRoot).catch((error) => {
    if (error?.code !== "ENOENT" && error?.code !== "ENOTEMPTY") {
      console.warn(`警告：无法删除空状态目录：${error.message}`);
    }
  });

  console.log(
    `完全卸载完成：清除了 ${result.removedCount} 项工具数据，共 ${formatBytes(result.removedBytes)}。`,
  );
  console.log("现在可以手动删除解压出来的工具文件夹。");
  return 0;
}

const action = process.argv[2];
const assumeYes = process.argv.includes("--yes");
const handlers = { check, preview, install, restore, cleanup, purge };

if (!handlers[action]) {
  console.error(
    "用法: node src/cli.mjs <check|preview|install|restore|cleanup|purge> [--yes]",
  );
  process.exitCode = 1;
} else {
  try {
    process.exitCode = await handlers[action]({ assumeYes });
  } catch (error) {
    console.error(`\n操作失败: ${error.message}`);
    console.error(`建议: ${getErrorAdvice(error)}`);
    const logPath = await writeDiagnosticLog({ action, error }).catch(() => null);
    if (logPath) {
      console.error(`错误日志: ${logPath}`);
    }
    process.exitCode = 1;
  }
}
