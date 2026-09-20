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

function createArchiveStreams({
  sourceAsarPath,
  sourceUnpackedPath,
  header,
  dataOffset,
  replacementPath,
  replacementBuffer,
}) {
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

      const isReplacement = archivePath === replacementPath;
      const size = isReplacement ? replacementBuffer.length : Number(entry.size);
      const unpacked = Boolean(entry.unpacked);
      const streamGenerator = isReplacement
        ? () => Readable.from(replacementBuffer)
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
  const streams = createArchiveStreams({
    sourceAsarPath,
    sourceUnpackedPath,
    header,
    dataOffset,
    replacementPath: customSchemePath,
    replacementBuffer: patchedBuffer,
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
