import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Readable } from "node:stream";
import { sha256Buffer, sha256File } from "./hash.mjs";
import {
  getAsarEntry,
  readAsarHeader,
  readFileFromAsar,
  readJsonFromAsar,
} from "./asar-reader.mjs";

const SCHEME_LIST_ANCHOR = `        },
    ]);
}`;

const SCHEME_LIST_REPLACEMENT = `        },
        {
            scheme: 'agy-zhcn',
            privileges: {
                standard: true,
                secure: true,
                supportFetchAPI: true,
                corsEnabled: true,
                codeCache: true,
            },
        },
    ]);
}`;

const HANDLER_SUFFIX = `    });
}
`;

const HANDLER_REPLACEMENT = `    });

    // Antigravity Desktop ZHCN: serve a verified local UI bundle.
    electron_1.session.defaultSession.clearCache().catch((err) => {
        console.error("Failed to clear cache before loading ZHCN UI:", err);
    });
    electron_1.protocol.handle('agy-zhcn', async () => {
        const path = require("path");
        const fsPromises = require("fs/promises");
        const bundlePath = path.join(electron_1.app.getPath('userData'), 'agy_zhcn_ui_main.js');
        const content = await fsPromises.readFile(bundlePath);
        return new Response(content, {
            status: 200,
            headers: {
                'Content-Type': 'application/javascript; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-store'
            }
        });
    });
    electron_1.session.defaultSession.webRequest.onBeforeRequest(
        { urls: ['https://127.0.0.1:*/main.js'] },
        (_details, callback) => {
            callback({ redirectURL: 'agy-zhcn://bundle/main.js' });
        }
    );

    // Antigravity Desktop ZHCN: localize Electron native tray, dock, and application menus.
    try {
        const translateNativeMenuText = (text) => {
            if (typeof text !== 'string') return text;
            const trimmed = text.trim();
            if (trimmed === 'No agents running') return '无正在运行的智能体';
            if (trimmed === 'Quit') return '退出';
            if (trimmed === 'New Window') return '新建窗口';
            if (trimmed === 'Docs') return '文档';
            if (trimmed === 'Check for Updates') return '检查更新';
            if (trimmed === 'Checking for Updates...') return '正在检查更新...';
            if (trimmed === 'Downloading Update...') return '正在下载更新...';
            if (trimmed === 'Restart to Update') return '重启以更新';
            if (trimmed.startsWith('Open ')) {
                return '打开 ' + trimmed.slice(5);
            }
            if (/^(\\d+)\\s+agents?\\s+running$/i.test(trimmed)) {
                return trimmed.replace(/^(\\d+)\\s+agents?\\s+running$/i, '$1 个智能体正在运行');
            }
            if (/^No\\s+agents?\\s+running$/i.test(trimmed)) {
                return '无正在运行的智能体';
            }
            return text;
        };

        const transformMenuTemplate = (items) => {
            if (!Array.isArray(items)) return items;
            return items.map((item) => {
                if (!item || typeof item !== 'object') return item;
                const copy = { ...item };
                if (typeof copy.label === 'string') {
                    copy.label = translateNativeMenuText(copy.label);
                }
                if (Array.isArray(copy.submenu)) {
                    copy.submenu = transformMenuTemplate(copy.submenu);
                }
                return copy;
            });
        };

        if (electron_1.Menu && !electron_1.Menu.__zhcnPatched) {
            electron_1.Menu.__zhcnPatched = true;
            const origBuildFromTemplate = electron_1.Menu.buildFromTemplate;
            if (typeof origBuildFromTemplate === 'function') {
                electron_1.Menu.buildFromTemplate = function (template) {
                    return origBuildFromTemplate.call(this, transformMenuTemplate(template));
                };
            }
            if (electron_1.Menu.prototype) {
                const origAppend = electron_1.Menu.prototype.append;
                if (typeof origAppend === 'function') {
                    electron_1.Menu.prototype.append = function (menuItem) {
                        if (menuItem && typeof menuItem.label === 'string') {
                            menuItem.label = translateNativeMenuText(menuItem.label);
                        }
                        return origAppend.call(this, menuItem);
                    };
                }
                const origInsert = electron_1.Menu.prototype.insert;
                if (typeof origInsert === 'function') {
                    electron_1.Menu.prototype.insert = function (pos, menuItem) {
                        if (menuItem && typeof menuItem.label === 'string') {
                            menuItem.label = translateNativeMenuText(menuItem.label);
                        }
                        return origInsert.call(this, pos, menuItem);
                    };
                }
            }
        }

        if (electron_1.MenuItem && !electron_1.MenuItem.__zhcnPatched) {
            electron_1.MenuItem.__zhcnPatched = true;
            const proto = electron_1.MenuItem.prototype;
            const origDescriptor = Object.getOwnPropertyDescriptor(proto, 'label');
            if (origDescriptor && origDescriptor.set) {
                Object.defineProperty(proto, 'label', {
                    get: origDescriptor.get,
                    set: function (val) {
                        return origDescriptor.set.call(this, translateNativeMenuText(val));
                    },
                    configurable: true,
                    enumerable: true,
                });
            }
        }

        if (electron_1.Tray && electron_1.Tray.prototype && !electron_1.Tray.__zhcnPatched) {
            electron_1.Tray.__zhcnPatched = true;
            const origSetContextMenu = electron_1.Tray.prototype.setContextMenu;
            if (typeof origSetContextMenu === 'function') {
                electron_1.Tray.prototype.setContextMenu = function (menu) {
                    if (menu && Array.isArray(menu.items)) {
                        for (const item of menu.items) {
                            if (item && typeof item.label === 'string') {
                                item.label = translateNativeMenuText(item.label);
                            }
                        }
                    }
                    return origSetContextMenu.call(this, menu);
                };
            }
        }
    } catch (menuErr) {
        console.error("Failed to hook native menu localization:", menuErr);
    }

    // Antigravity Desktop ZHCN: localize Electron native dialogs (showMessageBox, showErrorBox).
    try {
        const path = require("path");
        const fs = require("fs");
        let externalDialogRules = null;
        let lastExternalDialogCheck = 0;

        const loadExternalDialogRules = () => {
            const now = Date.now();
            if (externalDialogRules && (now - lastExternalDialogCheck) < 5000) {
                return externalDialogRules;
            }
            lastExternalDialogCheck = now;
            try {
                const userData = electron_1.app && typeof electron_1.app.getPath === 'function' ? electron_1.app.getPath('userData') : '';
                if (userData) {
                    const ruleFile = path.join(userData, 'agy_zhcn_dialog.json');
                    if (fs.existsSync(ruleFile)) {
                        const raw = fs.readFileSync(ruleFile, 'utf8');
                        externalDialogRules = JSON.parse(raw);
                        return externalDialogRules;
                    }
                }
            } catch (_loadErr) {}
            return null;
        };

        const nativeDialogExactMap = {
            'Check for Updates': '检查更新',
            'Checking for Updates...': '正在检查更新...',
            'Checking for updates...': '正在检查更新...',
            'Downloading Update...': '正在下载更新...',
            'Downloading update...': '正在下载更新...',
            'Restart to Update': '重启以更新',
            'No updates available': '没有可用的更新',
            'No updates available.': '没有可用的更新。',
            'No update available': '没有可用的更新',
            'No update available.': '没有可用的更新。',
            'Update Available': '发现新版本',
            'Update available': '发现新版本',
            'Update Not Available': '没有可用的更新',
            'Update not available': '没有可用的更新',
            'Update Downloaded': '更新已下载',
            'Update downloaded': '更新已下载',
            'Update Error': '更新失败',
            'Update error': '更新失败',
            'Update Failed': '更新失败',
            'Update failed': '更新失败',
            'Update check failed': '检查更新失败',
            'There are no updates available at this time.': '当前没有可用的更新。',
            'You are running the latest version.': '您当前已是最新版本。',
            'A new version is available. Would you like to download it now?': '发现新版本。您想现在下载吗？',
            'A new version has been downloaded. Restart the application to apply the updates.': '新版本已下载完成。重启应用程序以应用更新。',
            'Confirm Quit': '确认退出',
            'Are you sure you want to quit?': '确定要退出吗？',
            'There may be agents or background tasks running.': '可能有正在运行的智能体或后台任务。',
            'Quit Antigravity': '退出 Antigravity',
            'WSL distro not found': '未找到 WSL 发行版',
            'Antigravity opened on Windows instead.': 'Antigravity 已在 Windows 环境中打开。',
            'Binary not found': '未找到二进制执行文件',
            'WSL setup failed': 'WSL 配置失败',
            'Startup failed': '启动失败',
            'Cannot open folder': '无法打开文件夹',
            'Folder is on the Windows filesystem': '文件夹位于 Windows 文件系统中',
            'Open workspace': '打开工作区',
            'Error': '错误',
            'Warning': '警告',
            'Information': '提示',
            'Question': '提示',
            'OK': '确定',
            'Ok': '确定',
            'Cancel': '取消',
            'Yes': '是',
            'No': '否',
            'Retry': '重试',
            'Ignore': '忽略',
            'Close': '关闭',
            'Quit': '退出',
            'Restart': '重启',
            'Later': '稍后',
            'Install and Relaunch': '安装并重启',
            'Install and Restart': '安装并重启',
            'Download': '下载',
            'Download Now': '立即下载',
            'Learn More': '了解更多',
            'Open Settings': '打开设置',
            'Open Folder': '打开文件夹',
            'Open Workspace': '打开工作区',
            'Continue': '继续'
        };

        const nativeDialogPatterns = [
            { reg: /^A new version\s+([0-9a-zA-Z._-]+)\s+is available/i, rep: '发现新版本 $1 可用' },
            { reg: /^Version\s+([0-9a-zA-Z._-]+)\s+is available/i, rep: '版本 $1 现已可用' },
            { reg: /^Downloading\s+(?:update\s+)?([0-9]+(?:\.[0-9]+)?%)/i, rep: '正在下载更新 ($1)' },
            { reg: /^An error occurred(?::\s*(.*))?$/i, rep: '$1' ? '发生错误：$1' : '发生错误' },
            { reg: /^Failed to check for updates(?::\s*(.*))?$/i, rep: '$1' ? '检查更新失败：$1' : '检查更新失败' },
            { reg: /^Failed to download update(?::\s*(.*))?$/i, rep: '$1' ? '下载更新失败：$1' : '下载更新失败' },
            { reg: /^There is no update available at this time\.?$/i, rep: '当前没有可用的更新。' },
            { reg: /^You are already on the latest version\.?$/i, rep: '您当前已是最新版本。' }
        ];

        const translateDialogText = (text) => {
            if (typeof text !== 'string') return text;
            const trimmed = text.trim();
            if (!trimmed) return text;

            // 1. 外部动态配置优先
            const ext = loadExternalDialogRules();
            if (ext) {
                if (ext.exact && typeof ext.exact[trimmed] === 'string') {
                    return ext.exact[trimmed];
                }
                if (Array.isArray(ext.patterns)) {
                    for (const p of ext.patterns) {
                        try {
                            const r = new RegExp(p.pattern, p.flags || 'i');
                            if (r.test(trimmed)) {
                                return trimmed.replace(r, p.replacement);
                            }
                        } catch (_err) {}
                    }
                }
            }

            // 2. 内置精确翻译
            if (nativeDialogExactMap[trimmed]) {
                return nativeDialogExactMap[trimmed];
            }

            // 3. 内置模式正则
            for (const item of nativeDialogPatterns) {
                if (item.reg.test(trimmed)) {
                    return trimmed.replace(item.reg, item.rep);
                }
            }

            // 4. 泛化词组替换兜底（处理复合短语）
            let result = text;
            let replaced = false;
            for (const [k, v] of Object.entries(nativeDialogExactMap)) {
                if (k.length >= 4 && result.includes(k)) {
                    result = result.split(k).join(v);
                    replaced = true;
                }
            }
            if (replaced) return result;

            return text;
        };

        const localizeDialogOptions = (opts) => {
            if (!opts || typeof opts !== 'object') return opts;
            const copy = { ...opts };
            if (typeof copy.title === 'string') {
                copy.title = translateDialogText(copy.title);
            }
            if (typeof copy.message === 'string') {
                copy.message = translateDialogText(copy.message);
            }
            if (typeof copy.detail === 'string') {
                copy.detail = translateDialogText(copy.detail);
            }
            if (typeof copy.checkboxLabel === 'string') {
                copy.checkboxLabel = translateDialogText(copy.checkboxLabel);
            }
            if (Array.isArray(copy.buttons)) {
                copy.buttons = copy.buttons.map((btn) => {
                    if (typeof btn === 'string') {
                        return translateDialogText(btn);
                    }
                    return btn;
                });
            }
            return copy;
        };

        if (electron_1.dialog && !electron_1.dialog.__zhcnPatched) {
            electron_1.dialog.__zhcnPatched = true;

            const origShowMessageBox = electron_1.dialog.showMessageBox;
            if (typeof origShowMessageBox === 'function') {
                electron_1.dialog.showMessageBox = function (arg1, arg2) {
                    if (arg2 !== undefined && typeof arg2 === 'object') {
                        return origShowMessageBox.call(this, arg1, localizeDialogOptions(arg2));
                    }
                    if (arg1 && typeof arg1 === 'object' && !arg1.webContents) {
                        return origShowMessageBox.call(this, localizeDialogOptions(arg1));
                    }
                    return origShowMessageBox.call(this, arg1, arg2);
                };
            }

            const origShowMessageBoxSync = electron_1.dialog.showMessageBoxSync;
            if (typeof origShowMessageBoxSync === 'function') {
                electron_1.dialog.showMessageBoxSync = function (arg1, arg2) {
                    if (arg2 !== undefined && typeof arg2 === 'object') {
                        return origShowMessageBoxSync.call(this, arg1, localizeDialogOptions(arg2));
                    }
                    if (arg1 && typeof arg1 === 'object' && !arg1.webContents) {
                        return origShowMessageBoxSync.call(this, localizeDialogOptions(arg1));
                    }
                    return origShowMessageBoxSync.call(this, arg1, arg2);
                };
            }

            const origShowErrorBox = electron_1.dialog.showErrorBox;
            if (typeof origShowErrorBox === 'function') {
                electron_1.dialog.showErrorBox = function (title, content) {
                    return origShowErrorBox.call(this, translateDialogText(title), translateDialogText(content));
                };
            }
        }
    } catch (dialogErr) {
        console.error("Failed to hook native dialog localization:", dialogErr);
    }
}
`;

export function patchCustomSchemeSource(source) {
  const normalized = source.replaceAll("\r\n", "\n");
  if (normalized.includes("agy-zhcn://bundle/main.js")) {
    throw new Error("customScheme.js 已包含本项目补丁。");
  }

  const schemeAnchorCount = normalized.split(SCHEME_LIST_ANCHOR).length - 1;
  const handlerSuffixCount = normalized.split(HANDLER_SUFFIX).length - 1;
  if (schemeAnchorCount !== 1 || handlerSuffixCount !== 1) {
    throw new Error("customScheme.js 补丁锚点不唯一，拒绝修改。");
  }

  return normalized
    .replace(SCHEME_LIST_ANCHOR, SCHEME_LIST_REPLACEMENT)
    .replace(HANDLER_SUFFIX, HANDLER_REPLACEMENT);
}

export function patchLoadingOverlaySource(source) {
  const normalized = source.replaceAll("\r\n", "\n");
  if (normalized.includes("正在加载 Antigravity")) {
    return normalized;
  }
  return normalized.replace(
    '<div class="text">Loading Antigravity</div>',
    '<div class="text">正在加载 Antigravity...</div>',
  );
}

function createArchiveStreams({
  sourceAsarPath,
  sourceUnpackedPath,
  header,
  dataOffset,
  replacementPath,
  replacementBuffer,
  replacements,
}) {
  const replacementMap = new Map();
  if (replacements instanceof Map) {
    for (const [k, v] of replacements.entries()) replacementMap.set(k, v);
  } else if (replacements && typeof replacements === "object") {
    for (const [k, v] of Object.entries(replacements)) replacementMap.set(k, v);
  }
  if (replacementPath && replacementBuffer) {
    replacementMap.set(replacementPath, replacementBuffer);
  }

  const streams = [];

  function walk(directory, parentPath = "") {
    for (const [name, entry] of Object.entries(directory.files ?? {})) {
      const archivePath = parentPath ? `${parentPath}/${name}` : name;

      if (entry.files) {
        streams.push({
          type: "directory",
          path: archivePath,
          unpacked: Boolean(entry.unpacked),
        });
        walk(entry, archivePath);
        continue;
      }

      if (entry.link) {
        streams.push({
          type: "link",
          path: archivePath,
          unpacked: Boolean(entry.unpacked),
          symlink: entry.link,
          stat: {
            size: 0,
            mode: 0o120777,
          },
          streamGenerator: () => Readable.from([]),
        });
        continue;
      }

      const repBuf = replacementMap.get(archivePath);
      const isReplacement = Boolean(repBuf);
      const size = isReplacement ? repBuf.length : Number(entry.size);
      const unpacked = Boolean(entry.unpacked);
      const streamGenerator = isReplacement
        ? () => Readable.from(repBuf)
        : unpacked
          ? () =>
              createReadStream(
                path.join(
                  sourceUnpackedPath,
                  ...archivePath.split("/"),
                ),
              )
          : size === 0
            ? () => Readable.from([])
            : () =>
                createReadStream(sourceAsarPath, {
                  start: dataOffset + Number(entry.offset),
                  end: dataOffset + Number(entry.offset) + size - 1,
                });

      streams.push({
        type: "file",
        path: archivePath,
        unpacked,
        stat: {
          size,
          mode: entry.executable ? 0o100755 : 0o100644,
        },
        streamGenerator,
      });
    }
  }

  walk(header);
  return streams;
}

function alignToFour(value) {
  return value + ((4 - (value % 4)) % 4);
}

function serializeAsarHeader(header) {
  const jsonBuffer = Buffer.from(JSON.stringify(header), "utf8");
  const stringPayloadSize = 4 + alignToFour(jsonBuffer.length);
  const headerPickle = Buffer.alloc(4 + stringPayloadSize);
  headerPickle.writeUInt32LE(stringPayloadSize, 0);
  headerPickle.writeInt32LE(jsonBuffer.length, 4);
  jsonBuffer.copy(headerPickle, 8);

  const sizePickle = Buffer.alloc(8);
  sizePickle.writeUInt32LE(4, 0);
  sizePickle.writeUInt32LE(headerPickle.length, 4);
  return Buffer.concat([sizePickle, headerPickle]);
}

function restoreExecutableFlags(originalHeader, patchedHeader) {
  function walk(originalDirectory, parentPath = "") {
    for (const [name, originalEntry] of Object.entries(
      originalDirectory.files ?? {},
    )) {
      const archivePath = parentPath ? `${parentPath}/${name}` : name;
      if (originalEntry.files) {
        walk(originalEntry, archivePath);
        continue;
      }

      const patchedEntry = getAsarEntry(patchedHeader, archivePath);
      if (originalEntry.executable) {
        patchedEntry.executable = true;
      } else {
        delete patchedEntry.executable;
      }
    }
  }

  walk(originalHeader);
}

async function rewriteHeaderWithOriginalExecutableFlags({
  outputAsarPath,
  originalHeader,
}) {
  const builtArchive = await readFile(outputAsarPath);
  const { header: builtHeader, dataOffset } =
    await readAsarHeader(outputAsarPath);
  restoreExecutableFlags(originalHeader, builtHeader);
  const serializedHeader = serializeAsarHeader(builtHeader);
  const rewrittenPath = `${outputAsarPath}.${process.pid}.header.tmp`;
  await writeFile(
    rewrittenPath,
    Buffer.concat([serializedHeader, builtArchive.subarray(dataOffset)]),
  );
  await rm(outputAsarPath, { force: true });
  await rename(rewrittenPath, outputAsarPath);
}

export async function buildPatchedAsar({
  sourceAsarPath,
  sourceUnpackedPath = `${sourceAsarPath}.unpacked`,
  outputAsarPath,
  customSchemePath,
  expectedCustomSchemeSha256,
}) {
  const { createPackageFromStreams } = await import("@electron/asar");
  const { header, dataOffset } = await readAsarHeader(sourceAsarPath);
  const originalEntry = getAsarEntry(header, customSchemePath);
  if (originalEntry.unpacked) {
    throw new Error("customScheme.js 意外位于 unpacked 区域，拒绝修改。");
  }

  const originalBuffer = await readFileFromAsar(
    sourceAsarPath,
    customSchemePath,
  );
  const originalHash = sha256Buffer(originalBuffer);
  if (originalHash !== expectedCustomSchemeSha256) {
    throw new Error(`customScheme.js 指纹不匹配：${originalHash}`);
  }

  const patchedBuffer = Buffer.from(
    patchCustomSchemeSource(originalBuffer.toString("utf8")),
    "utf8",
  );

  const replacements = new Map();
  replacements.set(customSchemePath, patchedBuffer);

  // If loadingOverlay.js exists, localize its initial loading text
  const loadingOverlayPath = "dist/loadingOverlay.js";
  const loadingEntry = getAsarEntry(header, loadingOverlayPath);
  if (loadingEntry && !loadingEntry.unpacked) {
    const rawLoadingBuffer = await readFileFromAsar(
      sourceAsarPath,
      loadingOverlayPath,
    );
    const patchedLoadingBuffer = Buffer.from(
      patchLoadingOverlaySource(rawLoadingBuffer.toString("utf8")),
      "utf8",
    );
    replacements.set(loadingOverlayPath, patchedLoadingBuffer);
  }

  const streams = createArchiveStreams({
    sourceAsarPath,
    sourceUnpackedPath,
    header,
    dataOffset,
    replacements,
  });

  await mkdir(path.dirname(outputAsarPath), { recursive: true });
  const isolatedWorkingDirectory = await mkdtemp(
    path.join(os.tmpdir(), "antigravity-zhcn-asar-cwd-"),
  );
  const previousWorkingDirectory = process.cwd();
  try {
    // @electron/asar probes small files by their relative archive path before
    // falling back to streamGenerator(). An empty cwd prevents an unrelated
    // project file (for example package.json) from poisoning ASAR integrity.
    process.chdir(isolatedWorkingDirectory);
    await createPackageFromStreams(outputAsarPath, streams);
  } finally {
    process.chdir(previousWorkingDirectory);
    await rm(isolatedWorkingDirectory, { recursive: true, force: true });
  }
  await rewriteHeaderWithOriginalExecutableFlags({
    outputAsarPath,
    originalHeader: header,
  });

  // The installed app.asar.unpacked directory is left untouched. A temporary
  // sibling created during archive construction is not part of the patch.
  await rm(`${outputAsarPath}.unpacked`, { recursive: true, force: true });

  const packageJson = await readJsonFromAsar(outputAsarPath, "package.json");
  const verifiedPatchedSource = await readFileFromAsar(
    outputAsarPath,
    customSchemePath,
  );
  if (
    !verifiedPatchedSource
      .toString("utf8")
      .includes("agy-zhcn://bundle/main.js")
  ) {
    throw new Error("新 ASAR 包未通过补丁内容验证。");
  }

  return {
    packageVersion: packageJson.version,
    patchedAsarSha256: await sha256File(outputAsarPath),
    patchedCustomSchemeSha256: sha256Buffer(verifiedPatchedSource),
  };
}

export async function atomicReplaceFile({
  currentPath,
  replacementPath,
  currentExpectedHash,
  replacementExpectedHash,
}) {
  const directory = path.dirname(currentPath);
  const token = `${process.pid}-${Date.now()}`;
  const stagedPath = path.join(directory, `.agy-zhcn-new-${token}.tmp`);
  const displacedPath = path.join(directory, `.agy-zhcn-old-${token}.tmp`);

  const currentHash = await sha256File(currentPath);
  if (currentHash !== currentExpectedHash) {
    throw new Error("待替换文件的当前哈希不一致，拒绝替换。");
  }

  await copyFile(replacementPath, stagedPath);
  const stagedHash = await sha256File(stagedPath);
  if (stagedHash !== replacementExpectedHash) {
    await rm(stagedPath, { force: true });
    throw new Error("暂存文件哈希不一致，拒绝替换。");
  }

  await rename(currentPath, displacedPath);
  try {
    const displacedHash = await sha256File(displacedPath);
    if (displacedHash !== currentExpectedHash) {
      throw new Error("被替换文件转移后的哈希验证失败。");
    }
    await rename(stagedPath, currentPath);
    const installedHash = await sha256File(currentPath);
    if (installedHash !== replacementExpectedHash) {
      throw new Error("替换后的文件哈希验证失败。");
    }
  } catch (error) {
    await rm(currentPath, { force: true }).catch(() => {});
    await rename(displacedPath, currentPath).catch(() => {});
    await rm(stagedPath, { force: true }).catch(() => {});
    throw error;
  }

  return {
    displacedPath,
    finalize: async () => rm(displacedPath, { force: true }),
    rollback: async () => {
      const rollbackStagedPath = path.join(
        directory,
        `.agy-zhcn-rollback-${token}.tmp`,
      );
      const displacedHash = await sha256File(displacedPath);
      if (displacedHash !== currentExpectedHash) {
        throw new Error("回滚源文件哈希异常。");
      }

      await rename(currentPath, rollbackStagedPath);
      try {
        await rename(displacedPath, currentPath);
        const restoredHash = await sha256File(currentPath);
        if (restoredHash !== currentExpectedHash) {
          throw new Error("回滚后的文件哈希验证失败。");
        }
        await rm(rollbackStagedPath, { force: true });
      } catch (error) {
        await rm(currentPath, { force: true }).catch(() => {});
        await rename(rollbackStagedPath, currentPath).catch(() => {});
        throw error;
      }
    },
  };
}
