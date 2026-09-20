import { createPrivateKey, sign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCompatibilityManifest } from "../src/lib/installation.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} 缺少参数值。`);
  return value;
}

const sequence = Number(readOption("--sequence"));
if (!Number.isSafeInteger(sequence) || sequence < 1) {
  throw new Error("必须使用 --sequence 提供正整数防回滚序号。");
}
const expiresDays = Number(readOption("--expires-days") ?? 180);
if (!Number.isSafeInteger(expiresDays) || expiresDays < 1 || expiresDays > 366) {
  throw new Error("--expires-days 必须是 1 到 366 之间的整数。");
}
const privateKeyPath = path.resolve(
  readOption("--private-key") ??
    process.env.AGY_COMPATIBILITY_SIGNING_KEY ??
    path.join(projectRoot, ".runtime", "signing", "compatibility-ed25519-private.pem"),
);
const outputDirectory = path.join(projectRoot, "config", "remote");
const manifestPath = path.join(outputDirectory, "compatibility-manifest.json");
const signaturePath = `${manifestPath}.sig`;
const manifest = await loadCompatibilityManifest();
const issuedAt = new Date();
const document = {
  schemaVersion: 1,
  sequence,
  issuedAt: issuedAt.toISOString(),
  expiresAt: new Date(issuedAt.getTime() + expiresDays * 24 * 60 * 60_000).toISOString(),
  targets: manifest.targets,
};
const payload = Buffer.from(`${JSON.stringify(document, null, 2)}\n`);
const privateKey = createPrivateKey(await readFile(privateKeyPath));
const signature = sign(null, payload, privateKey).toString("base64");
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(manifestPath, payload),
  writeFile(signaturePath, `${signature}\n`, "utf8"),
]);
console.log(`远程兼容性清单: ${manifestPath}`);
console.log(`签名文件: ${signaturePath}`);
console.log(`防回滚序号: ${sequence}`);
console.log(`目标数量: ${manifest.targets.length}`);
