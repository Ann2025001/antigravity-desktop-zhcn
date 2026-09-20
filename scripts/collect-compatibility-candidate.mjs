import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectCompatibilityCandidate,
} from "../src/lib/compatibility-candidate.mjs";
import { resolveInstallRoot } from "../src/lib/paths.mjs";
import {
  fetchUiBundle,
  findLatestUiPort,
} from "../src/lib/runtime-bundle.mjs";
import { readInstallState } from "../src/lib/state.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} 缺少参数值。`);
  }
  return value;
}

const customSchemePath =
  readOption("--custom-scheme") ?? "dist/customScheme.js";
const explicitAsarPath = readOption("--asar");
const explicitUiPath = readOption("--ui-bundle");
const explicitOutputPath = readOption("--output");

let installRoot = null;
let installSource = null;
let appAsarPath;
if (explicitAsarPath) {
  appAsarPath = path.resolve(explicitAsarPath);
} else {
  const resolved = await resolveInstallRoot();
  installRoot = resolved.installRoot;
  installSource = resolved.sourceLabel;
  appAsarPath = path.join(installRoot, "resources", "app.asar");
}

let uiBundle;
let uiSource;
if (explicitUiPath) {
  uiBundle = await readFile(path.resolve(explicitUiPath));
  uiSource = path.resolve(explicitUiPath);
} else {
  const port = await findLatestUiPort();
  if (!port) {
    throw new Error(
      "未找到运行中的 Antigravity UI；请打开客户端，或使用 --ui-bundle 指定文件。",
    );
  }
  uiBundle = await fetchUiBundle(port);
  uiSource = `https://127.0.0.1:${port}/main.js`;
}

const generatedAt = new Date().toISOString();
const target = await collectCompatibilityCandidate({
  appAsarPath,
  uiBundle,
  customSchemePath,
  collectedAt: generatedAt,
});

const state = await readInstallState();
if (
  state?.status === "installed" &&
  state.patchedAsarSha256 === target.appAsarSha256
) {
  throw new Error("当前 app.asar 已安装汉化补丁；请先恢复英文再采集候选。");
}

const outputPath = explicitOutputPath
  ? path.resolve(explicitOutputPath)
  : path.join(
      projectRoot,
      ".runtime",
      "compatibility-candidates",
      `${target.appVersion}-${target.platform}-${target.arch}.json`,
    );
const document = {
  schemaVersion: 1,
  status: "candidate",
  generatedAt,
  warning: "此文件未经完整验证，不能直接加入兼容性白名单。",
  source: {
    installRoot,
    installSource,
    appAsarPath,
    uiSource,
  },
  target,
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");

console.log(`候选版本: ${target.appVersion} / ${target.platform} ${target.arch}`);
console.log(`app.asar SHA256: ${target.appAsarSha256}`);
console.log(`customScheme SHA256: ${target.customSchemeSha256}`);
console.log(`运行时 UI SHA256: ${target.uiBundleSha256}`);
console.log(`候选文件: ${outputPath}`);
console.log(
  `注意：候选尚未验证，不会自动修改 config/compatibility/${target.appVersion}/${target.platform}-${target.arch}.json。`,
);
