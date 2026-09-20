import https from "node:https";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256Buffer, sha256File } from "./hash.mjs";
import { getAntigravityUserDataRoot, getStateRoot } from "./paths.mjs";

const MAX_BUNDLE_BYTES = 50 * 1024 * 1024;

export async function findLatestUiPort() {
  const logPath = path.join(getAntigravityUserDataRoot(), "logs", "main.log");
  let log;
  try {
    log = await readFile(logPath, "utf8");
  } catch {
    return null;
  }

  const matches = [...log.matchAll(/Local:\s+https:\/\/127\.0\.0\.1:(\d+)\//g)];
  return matches.at(-1)?.[1] ?? null;
}

export async function fetchUiBundle(port) {
  if (!/^\d{1,5}$/.test(String(port))) {
    throw new Error("Antigravity UI 端口无效。");
  }

  return new Promise((resolve, reject) => {
    const request = https.get(
      {
        hostname: "127.0.0.1",
        port: Number(port),
        path: "/main.js",
        method: "GET",
        rejectUnauthorized: false,
        timeout: 15_000,
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`读取运行时 UI 失败：HTTP ${response.statusCode}`));
          return;
        }

        const chunks = [];
        let totalBytes = 0;
        response.on("data", (chunk) => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_BUNDLE_BYTES) {
            request.destroy(new Error("运行时 UI 文件异常过大，已停止读取。"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve(Buffer.concat(chunks)));
        response.on("error", reject);
      },
    );
    request.on("timeout", () => request.destroy(new Error("读取运行时 UI 超时。")));
    request.on("error", reject);
  });
}

export function inspectUiBundle(buffer) {
  return {
    sha256: sha256Buffer(buffer),
    size: buffer.length,
  };
}

export function getCachedBundlePath(target) {
  return path.join(
    getStateRoot(),
    "cache",
    target.appVersion,
    target.uiBundleSha256,
    "main.js",
  );
}

export async function loadCompatibleUiBundle(target, { allowLiveFetch = true } = {}) {
  const cachedPath = getCachedBundlePath(target);
  try {
    const cachedHash = await sha256File(cachedPath);
    if (cachedHash === target.uiBundleSha256) {
      const buffer = await readFile(cachedPath);
      if (buffer.length === target.uiBundleSize) {
        return { buffer, source: "cache", path: cachedPath };
      }
    }
  } catch {
    // Cache is optional.
  }

  if (!allowLiveFetch) {
    throw new Error("没有找到与当前版本匹配的 UI 缓存，请先运行 Antigravity。");
  }

  const port = await findLatestUiPort();
  if (!port) {
    throw new Error("没有找到运行中的 Antigravity UI 端口，请先打开 Antigravity。");
  }

  const buffer = await fetchUiBundle(port);
  const inspected = inspectUiBundle(buffer);
  if (
    inspected.sha256 !== target.uiBundleSha256 ||
    inspected.size !== target.uiBundleSize
  ) {
    throw new Error(
      `运行时 UI 指纹不匹配：${inspected.sha256} (${inspected.size} bytes)。`,
    );
  }

  await mkdir(path.dirname(cachedPath), { recursive: true });
  await writeFile(cachedPath, buffer, { flag: "w" });
  return { buffer, source: "live", path: cachedPath };
}

export async function waitForCompatibleUiBundle(
  target,
  { timeoutMs = 120_000, pollIntervalMs = 1_000 } = {},
) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await loadCompatibleUiBundle(target);
    } catch (error) {
      if (/指纹不匹配|异常过大/.test(error.message)) {
        throw error;
      }
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    "等待 Antigravity 主界面加载超时。请确认客户端已正常进入主界面。",
    { cause: lastError },
  );
}
