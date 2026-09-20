import { open, readFile } from "node:fs/promises";
import path from "node:path";

const FIXED_HEADER_SIZE = 16;
const MAX_HEADER_SIZE = 16 * 1024 * 1024;

export async function readAsarHeader(asarPath) {
  const handle = await open(asarPath, "r");
  try {
    const fixedHeader = Buffer.alloc(FIXED_HEADER_SIZE);
    const { bytesRead } = await handle.read(fixedHeader, 0, fixedHeader.length, 0);
    if (bytesRead !== fixedHeader.length) {
      throw new Error("ASAR 文件头不完整。");
    }

    const headerPickleSize = fixedHeader.readUInt32LE(4);
    const jsonSize = fixedHeader.readUInt32LE(12);
    if (
      headerPickleSize < 8 ||
      headerPickleSize > MAX_HEADER_SIZE ||
      jsonSize <= 0 ||
      jsonSize > headerPickleSize
    ) {
      throw new Error("ASAR 文件头尺寸异常。");
    }

    const jsonBuffer = Buffer.alloc(jsonSize);
    const jsonRead = await handle.read(jsonBuffer, 0, jsonSize, FIXED_HEADER_SIZE);
    if (jsonRead.bytesRead !== jsonSize) {
      throw new Error("ASAR 索引读取不完整。");
    }

    return {
      header: JSON.parse(jsonBuffer.toString("utf8")),
      dataOffset: 8 + headerPickleSize,
    };
  } finally {
    await handle.close();
  }
}

export function getAsarEntry(header, entryPath) {
  let current = header;
  for (const part of entryPath.replaceAll("\\", "/").split("/").filter(Boolean)) {
    current = current.files?.[part];
    if (!current) {
      throw new Error(`ASAR 内不存在文件：${entryPath}`);
    }
  }
  return current;
}

export async function readFileFromAsar(asarPath, entryPath) {
  const { header, dataOffset } = await readAsarHeader(asarPath);
  const entry = getAsarEntry(header, entryPath);

  if (entry.files) {
    throw new Error(`ASAR 路径是目录而不是文件：${entryPath}`);
  }

  if (entry.unpacked) {
    const unpackedPath = path.join(
      `${asarPath}.unpacked`,
      ...entryPath.replaceAll("\\", "/").split("/"),
    );
    return readFile(unpackedPath);
  }

  const offset = Number(entry.offset);
  const size = Number(entry.size);
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0) {
    throw new Error(`ASAR 文件索引非法：${entryPath}`);
  }

  const handle = await open(asarPath, "r");
  try {
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await handle.read(buffer, 0, size, dataOffset + offset);
    if (bytesRead !== size) {
      throw new Error(`ASAR 文件读取不完整：${entryPath}`);
    }
    return buffer;
  } finally {
    await handle.close();
  }
}

export async function readJsonFromAsar(asarPath, entryPath) {
  const content = await readFileFromAsar(asarPath, entryPath);
  return JSON.parse(content.toString("utf8"));
}
