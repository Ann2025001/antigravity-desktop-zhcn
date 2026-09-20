import { createPublicKey, verify } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { getStateRoot, projectRoot } from "./paths.mjs";

const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_SIGNATURE_BYTES = 4096;
const HASH_PATTERN = /^[A-F0-9]{64}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function validateTrustConfig(trust) {
  if (
    trust?.schemaVersion !== 1 ||
    trust.algorithm !== "Ed25519" ||
    typeof trust.publicKeySpkiBase64 !== "string" ||
    !Number.isFinite(trust.cacheTtlHours) ||
    trust.cacheTtlHours < 1 ||
    trust.cacheTtlHours > 168
  ) {
    throw new Error("远程兼容性信任配置格式无效。");
  }
  const manifestUrl = new URL(trust.manifestUrl);
  if (
    manifestUrl.protocol !== "https:" ||
    manifestUrl.hostname !== "raw.githubusercontent.com" ||
    !manifestUrl.pathname.startsWith(
      "/chenmo00000/antigravity-desktop-zhcn/",
    ) ||
    !manifestUrl.pathname.endsWith(
      "/config/remote/compatibility-manifest.json",
    )
  ) {
    throw new Error("远程兼容性清单地址不受信任。");
  }
  return { ...trust, manifestUrl: manifestUrl.href };
}

function validateTarget(target, index) {
  const source = `远程兼容性目标 ${index + 1}`;
  if (
    target?.platform !== "win32" ||
    target.arch !== "x64" ||
    !VERSION_PATTERN.test(target.appVersion ?? "") ||
    target.packageVersion !== target.appVersion ||
    !HASH_PATTERN.test(target.appAsarSha256 ?? "") ||
    !HASH_PATTERN.test(target.customSchemeSha256 ?? "") ||
    !HASH_PATTERN.test(target.uiBundleSha256 ?? "") ||
    !Number.isSafeInteger(target.uiBundleSize) ||
    target.uiBundleSize <= 0 ||
    typeof target.customSchemePath !== "string" ||
    !/^dist\/[0-9A-Za-z._/-]+\.js$/.test(target.customSchemePath) ||
    target.customSchemePath.includes("..")
  ) {
    throw new Error(`${source}格式无效。`);
  }
}

export function validateSignedCompatibilityDocument(
  document,
  { now = new Date() } = {},
) {
  if (
    document?.schemaVersion !== 1 ||
    !Number.isSafeInteger(document.sequence) ||
    document.sequence < 1 ||
    !Array.isArray(document.targets) ||
    document.targets.length < 1 ||
    document.targets.length > 256
  ) {
    throw new Error("远程兼容性清单格式无效。");
  }
  const issuedAt = new Date(document.issuedAt);
  const expiresAt = new Date(document.expiresAt);
  const nowTime = now.getTime();
  if (
    !Number.isFinite(issuedAt.getTime()) ||
    !Number.isFinite(expiresAt.getTime()) ||
    issuedAt.getTime() > nowTime + 5 * 60_000 ||
    expiresAt.getTime() <= nowTime ||
    expiresAt.getTime() <= issuedAt.getTime() ||
    expiresAt.getTime() - issuedAt.getTime() > 366 * 24 * 60 * 60_000
  ) {
    throw new Error("远程兼容性清单时间范围无效或已经过期。");
  }

  const keys = new Set();
  for (const [index, target] of document.targets.entries()) {
    validateTarget(target, index);
    const key = [
      target.platform,
      target.arch,
      target.appVersion,
      target.appAsarSha256,
    ].join("/");
    if (keys.has(key)) {
      throw new Error(`远程兼容性清单包含重复目标：${key}`);
    }
    keys.add(key);
  }
  return document;
}

export function verifySignedCompatibilityPayload({
  payload,
  signature,
  trust,
  now = new Date(),
}) {
  const verifiedTrust = validateTrustConfig(trust);
  const signatureText = Buffer.from(signature).toString("utf8").trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signatureText)) {
    throw new Error("远程兼容性签名编码无效。");
  }
  const signatureBuffer = Buffer.from(signatureText, "base64");
  if (signatureBuffer.length !== 64) {
    throw new Error("远程兼容性签名长度无效。");
  }
  const publicKey = createPublicKey({
    key: Buffer.from(verifiedTrust.publicKeySpkiBase64, "base64"),
    type: "spki",
    format: "der",
  });
  if (!verify(null, Buffer.from(payload), publicKey, signatureBuffer)) {
    throw new Error("远程兼容性清单签名验证失败。");
  }

  let document;
  try {
    document = JSON.parse(Buffer.from(payload).toString("utf8"));
  } catch (error) {
    throw new Error("远程兼容性清单不是有效 JSON。", { cause: error });
  }
  return validateSignedCompatibilityDocument(document, { now });
}

function targetKey(target) {
  return [
    target.platform,
    target.arch,
    target.appVersion,
    target.appAsarSha256,
  ].join("/");
}

function securityFieldsMatch(left, right) {
  return (
    left.packageVersion === right.packageVersion &&
    left.customSchemePath === right.customSchemePath &&
    left.customSchemeSha256 === right.customSchemeSha256 &&
    left.uiBundleSha256 === right.uiBundleSha256 &&
    left.uiBundleSize === right.uiBundleSize
  );
}

export function mergeCompatibilityManifests(localManifest, remoteDocument) {
  const targets = [...localManifest.targets];
  const byKey = new Map(targets.map((target) => [targetKey(target), target]));
  for (const remoteTarget of remoteDocument.targets) {
    const key = targetKey(remoteTarget);
    const existing = byKey.get(key);
    if (existing) {
      if (!securityFieldsMatch(existing, remoteTarget)) {
        throw new Error(`远程兼容性目标与内置目标冲突：${key}`);
      }
      continue;
    }
    targets.push(remoteTarget);
    byKey.set(key, remoteTarget);
  }
  return { schemaVersion: 1, targets };
}

export async function loadCompatibilityTrust({
  trustPath = path.join(projectRoot, "config", "compatibility-trust.json"),
} = {}) {
  const trust = JSON.parse(await readFile(trustPath, "utf8"));
  return validateTrustConfig(trust);
}

function fetchHttpsBuffer(url, { maxBytes, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: { "user-agent": "antigravity-desktop-zhcn" },
        timeout: timeoutMs,
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`远程兼容性服务返回 HTTP ${response.statusCode}。`));
          return;
        }
        const chunks = [];
        let totalBytes = 0;
        response.on("data", (chunk) => {
          totalBytes += chunk.length;
          if (totalBytes > maxBytes) {
            request.destroy(new Error("远程兼容性响应超过大小限制。"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve(Buffer.concat(chunks)));
        response.on("error", reject);
      },
    );
    request.on("timeout", () => request.destroy(new Error("远程兼容性请求超时。")));
    request.on("error", reject);
  });
}

async function writeAtomic(filePath, buffer) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  const previousPath = `${filePath}.${process.pid}.old`;
  await writeFile(temporaryPath, buffer, { flag: "w" });
  let previousMoved = false;
  try {
    try {
      await rename(filePath, previousPath);
      previousMoved = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await rename(temporaryPath, filePath);
    if (previousMoved) await rm(previousPath, { force: true });
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    if (previousMoved) {
      await rename(previousPath, filePath).catch(() => {});
    }
    throw error;
  }
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return null;
  }
}

async function readVerifiedCache({ cacheRoot, trust, now }) {
  try {
    const [payload, signature] = await Promise.all([
      readFile(path.join(cacheRoot, "compatibility-manifest.json")),
      readFile(path.join(cacheRoot, "compatibility-manifest.json.sig")),
    ]);
    const document = verifySignedCompatibilityPayload({
      payload,
      signature,
      trust,
      now,
    });
    return { payload, signature, document };
  } catch {
    return null;
  }
}

export async function loadEffectiveCompatibilityManifest({
  localManifest,
  trust = null,
  stateRoot = getStateRoot(),
  now = new Date(),
  allowNetwork = process.env.AGY_DISABLE_REMOTE_COMPATIBILITY !== "1",
  fetchBuffer = fetchHttpsBuffer,
} = {}) {
  const verifiedTrust = trust ? validateTrustConfig(trust) : await loadCompatibilityTrust();
  const cacheRoot = path.join(stateRoot, "compatibility");
  const checkPath = path.join(cacheRoot, "last-check.json");
  const [cached, lastCheck] = await Promise.all([
    readVerifiedCache({ cacheRoot, trust: verifiedTrust, now }),
    readJsonIfPresent(checkPath),
  ]);
  const ttlMs = verifiedTrust.cacheTtlHours * 60 * 60_000;
  const effectiveTtlMs = lastCheck?.failed ? Math.min(ttlMs, 15 * 60_000) : ttlMs;
  const checkedAt = new Date(lastCheck?.checkedAt ?? 0).getTime();
  const cacheFresh =
    Number.isFinite(checkedAt) &&
    now.getTime() >= checkedAt &&
    now.getTime() - checkedAt < effectiveTtlMs;

  if (!allowNetwork || cacheFresh) {
    if (!cached) {
      return { ...localManifest, remote: { status: "local-only" } };
    }
    return {
      ...mergeCompatibilityManifests(localManifest, cached.document),
      remote: { status: "verified-cache", sequence: cached.document.sequence },
    };
  }

  try {
    const signatureUrl = `${verifiedTrust.manifestUrl}.sig`;
    const [payload, signature] = await Promise.all([
      fetchBuffer(verifiedTrust.manifestUrl, { maxBytes: MAX_MANIFEST_BYTES }),
      fetchBuffer(signatureUrl, { maxBytes: MAX_SIGNATURE_BYTES }),
    ]);
    const document = verifySignedCompatibilityPayload({
      payload,
      signature,
      trust: verifiedTrust,
      now,
    });
    if (cached && document.sequence < cached.document.sequence) {
      throw new Error("远程兼容性清单序号低于本地已验证缓存。");
    }
    if (
      cached &&
      document.sequence === cached.document.sequence &&
      !Buffer.from(payload).equals(cached.payload)
    ) {
      throw new Error("远程兼容性清单在相同序号下内容发生变化。");
    }
    const merged = mergeCompatibilityManifests(localManifest, document);
    await Promise.all([
      writeAtomic(path.join(cacheRoot, "compatibility-manifest.json"), payload),
      writeAtomic(path.join(cacheRoot, "compatibility-manifest.json.sig"), signature),
      writeAtomic(
        checkPath,
        Buffer.from(`${JSON.stringify({ checkedAt: now.toISOString() }, null, 2)}\n`),
      ),
    ]);
    return {
      ...merged,
      remote: { status: "verified-network", sequence: document.sequence },
    };
  } catch (error) {
    await writeAtomic(
      checkPath,
      Buffer.from(
        `${JSON.stringify({ checkedAt: now.toISOString(), failed: true }, null, 2)}\n`,
      ),
    ).catch(() => {});
    if (cached) {
      return {
        ...mergeCompatibilityManifests(localManifest, cached.document),
        remote: {
          status: "verified-cache",
          sequence: cached.document.sequence,
          warning: error.message,
        },
      };
    }
    return {
      ...localManifest,
      remote: { status: "local-fallback", warning: error.message },
    };
  }
}

export async function verifyTrackedRemoteCompatibility({
  manifestPath = path.join(
    projectRoot,
    "config",
    "remote",
    "compatibility-manifest.json",
  ),
  signaturePath = `${manifestPath}.sig`,
  trust = null,
  now = new Date(),
} = {}) {
  const verifiedTrust = trust ? validateTrustConfig(trust) : await loadCompatibilityTrust();
  const [payload, signature] = await Promise.all([
    readFile(manifestPath),
    readFile(signaturePath),
  ]);
  return verifySignedCompatibilityPayload({
    payload,
    signature,
    trust: verifiedTrust,
    now,
  });
}
