import { readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getRuntimePreviewRoot,
  getStateRoot,
  projectRoot,
} from "./paths.mjs";

async function getPathSize(targetPath) {
  let targetStat;
  try {
    targetStat = await stat(targetPath);
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }

  if (!targetStat.isDirectory()) {
    return targetStat.size;
  }

  const entries = await readdir(targetPath, { withFileTypes: true });
  const sizes = await Promise.all(
    entries.map((entry) => getPathSize(path.join(targetPath, entry.name))),
  );
  return sizes.reduce((total, size) => total + size, 0);
}

function assertSafeChild(root, targetPath) {
  const relative = path.relative(path.resolve(root), path.resolve(targetPath));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`拒绝清理边界外路径：${targetPath}`);
  }
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function determinePurgeInstallAction({
  state,
  inspection,
  sameInstallRoot,
}) {
  if (state?.status !== "installed") return "none";
  if (!inspection || !sameInstallRoot) {
    throw new Error("当前客户端安装路径与汉化记录不一致，拒绝清除恢复数据。");
  }
  if (
    inspection.packageVersion === state.appVersion &&
    inspection.appAsarSha256 === state.patchedAsarSha256
  ) {
    return "restore";
  }
  if (
    inspection.target &&
    inspection.appAsarSha256 === inspection.target.appAsarSha256
  ) {
    return "already-original";
  }
  throw new Error(
    "当前客户端既不是记录中的汉化版本，也不是已验证的官方原版，拒绝清除恢复数据。",
  );
}

export async function inspectCleanupTargets({
  previewRoot = getRuntimePreviewRoot(),
  stateRoot = getStateRoot(),
  temporaryRoot = os.tmpdir(),
  workspaceRoot = projectRoot,
} = {}) {
  const candidates = [
    {
      label: "本地汉化预览",
      root: workspaceRoot,
      path: previewRoot,
    },
    {
      label: "开发验证副本",
      root: workspaceRoot,
      path: path.join(path.dirname(previewRoot), "validation"),
    },
    {
      label: "运行时 UI 缓存",
      root: stateRoot,
      path: path.join(stateRoot, "cache"),
    },
    {
      label: "安装准备文件",
      root: stateRoot,
      path: path.join(stateRoot, "prepared"),
    },
  ];

  let temporaryEntries = [];
  try {
    temporaryEntries = await readdir(temporaryRoot, { withFileTypes: true });
  } catch {
    // 无法读取系统临时目录时，仍可清理其余明确目录。
  }
  for (const entry of temporaryEntries) {
    if (
      entry.isDirectory() &&
      (entry.name.startsWith("antigravity-zhcn-build-") ||
        entry.name.startsWith("antigravity-zhcn-portable-"))
    ) {
      candidates.push({
        label: "中断后遗留的构建目录",
        root: temporaryRoot,
        path: path.join(temporaryRoot, entry.name),
      });
    }
  }

  const targets = [];
  for (const candidate of candidates) {
    assertSafeChild(candidate.root, candidate.path);
    const bytes = await getPathSize(candidate.path);
    if (bytes > 0) {
      targets.push({ ...candidate, bytes });
    }
  }
  return targets;
}

export async function inspectPurgeTargets(options = {}) {
  const stateRoot = options.stateRoot ?? getStateRoot();
  const cleanupTargets = await inspectCleanupTargets({
    ...options,
    stateRoot,
  });
  const persistentCandidates = [
    {
      label: "原版恢复备份",
      root: stateRoot,
      path: path.join(stateRoot, "backups"),
    },
    {
      label: "工具错误日志",
      root: stateRoot,
      path: path.join(stateRoot, "logs"),
    },
    {
      label: "安装与恢复状态",
      root: stateRoot,
      path: path.join(stateRoot, "install-state.json"),
    },
  ];

  let stateEntries = [];
  try {
    stateEntries = await readdir(stateRoot, { withFileTypes: true });
  } catch {
    // 状态目录不存在时没有需要补充的目标。
  }
  for (const entry of stateEntries) {
    if (
      entry.isFile() &&
      entry.name.startsWith("install-state.json.") &&
      entry.name.endsWith(".tmp")
    ) {
      persistentCandidates.push({
        label: "中断后遗留的状态临时文件",
        root: stateRoot,
        path: path.join(stateRoot, entry.name),
      });
    }
  }

  for (const candidate of persistentCandidates) {
    assertSafeChild(candidate.root, candidate.path);
    const bytes = await getPathSize(candidate.path);
    if (bytes > 0) {
      cleanupTargets.push({ ...candidate, bytes });
    }
  }
  return cleanupTargets;
}

export async function removeCleanupTargets(targets) {
  let removedBytes = 0;
  for (const target of targets) {
    assertSafeChild(target.root, target.path);
    await rm(target.path, { recursive: true, force: true });
    removedBytes += target.bytes;
  }
  return { removedCount: targets.length, removedBytes };
}
