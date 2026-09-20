import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { patchCustomSchemeSource } from "../src/lib/patcher.mjs";
import { loadCompatibilityManifest } from "../src/lib/installation.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".git" ||
      entry.name === ".runtime" ||
      entry.name === ".codebase-memory"
    ) {
      continue;
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const compatibility = await loadCompatibilityManifest();
const dictionary = JSON.parse(
  await readFile(path.join(projectRoot, "config", "dom-translations.json"), "utf8"),
);
const packageJson = JSON.parse(
  await readFile(path.join(projectRoot, "package.json"), "utf8"),
);
const packageLock = JSON.parse(
  await readFile(path.join(projectRoot, "package-lock.json"), "utf8"),
);

assert(compatibility.schemaVersion === 1, "兼容性清单版本错误。");
assert(compatibility.targets.length >= 1, "兼容性清单没有目标版本。");
const targetKeys = new Set();
for (const target of compatibility.targets) {
  const versionKey = `${target.platform}/${target.arch}/${target.appVersion}`;
  const key = `${versionKey}/${target.appAsarSha256}`;
  assert(!targetKeys.has(key), `兼容性清单存在重复构建：${key}`);
  targetKeys.add(key);
  assert(
    target.packageVersion === target.appVersion,
    `${versionKey} 的 packageVersion 与 appVersion 不一致。`,
  );
  for (const hashField of [
    "appAsarSha256",
    "customSchemeSha256",
    "uiBundleSha256",
  ]) {
    assert(
      /^[A-F0-9]{64}$/.test(target[hashField]),
      `${versionKey} 的 ${hashField} 格式无效。`,
    );
  }
  assert(
    Number.isSafeInteger(target.uiBundleSize) && target.uiBundleSize > 0,
    `${versionKey} 的 uiBundleSize 无效。`,
  );
}
assert(dictionary.schemaVersion === 2, "翻译词典版本错误。");
assert(
  Object.keys(dictionary.exact).length >= 200,
  "翻译词典数量异常。",
);
assert(
  Object.entries(dictionary.exact).every(
    ([source, translated]) => source && translated && source !== translated,
  ),
  "翻译词典包含空值或无效映射。",
);
assert(
  Object.keys(dictionary.exact).every(
    (source) => source === source.trim() && !/[\u3400-\u9fff]/u.test(source),
  ),
  "翻译词典包含带首尾空白或中文的源文本。",
);
assert(
  Object.values(dictionary.exact).every(
    (translated) => !Object.hasOwn(dictionary.exact, translated),
  ),
  "翻译词典存在连续映射，可能触发重复观察。",
);
assert(Array.isArray(dictionary.patterns), "动态翻译规则格式错误。");
assert(dictionary.patterns.length >= 1, "动态翻译规则为空。");
assert(
  dictionary.patterns.every(
    (pattern) =>
      pattern &&
      typeof pattern.source === "string" &&
      pattern.source.startsWith("^") &&
      pattern.source.endsWith("$") &&
      typeof pattern.target === "string" &&
      pattern.target.length > 0 &&
      pattern.flags === "u" &&
      !/[\u3400-\u9fff]/u.test(pattern.source) &&
      /[\u3400-\u9fff]/u.test(pattern.target),
  ),
  "动态翻译规则包含无效或范围过宽的映射。",
);
assert(
  new Set(dictionary.patterns.map((pattern) => pattern.source)).size ===
    dictionary.patterns.length,
  "动态翻译规则包含重复源表达式。",
);
for (const pattern of dictionary.patterns) {
  let regex;
  try {
    regex = new RegExp(pattern.source, pattern.flags);
  } catch {
    throw new Error(`动态翻译规则无法编译：${pattern.source}`);
  }
  assert(
    !regex.test(pattern.target),
    `动态翻译规则会重复匹配译文：${pattern.source}`,
  );
}
assert(
  packageJson.dependencies["@electron/asar"] === "4.2.1",
  "ASAR 工具版本没有锁定。",
);
assert(
  packageLock.packages["node_modules/@electron/asar"].version === "4.2.1",
  "package-lock.json 中的 ASAR 工具版本不一致。",
);

const syntheticPatchedSource = patchCustomSchemeSource(`"use strict";
function registerCustomSchemes() {
    protocol.registerSchemesAsPrivileged([
        {
            scheme: 'plugin',
        },
    ]);
}
function registerCustomSchemeHandlers() {
    protocol.handle('plugin', async () => {
    });
}
`);
assert(
  syntheticPatchedSource.includes("agy-zhcn://bundle/main.js"),
  "补丁生成器未写入重定向。",
);

const requiredLaunchers = [
  "一键检查兼容性.bat",
  "生成汉化预览.bat",
  "一键汉化.bat",
  "一键恢复英文.bat",
  "清理缓存.bat",
  "完全卸载.bat",
];
for (const launcher of requiredLaunchers) {
  const buffer = await readFile(path.join(projectRoot, launcher));
  const content = buffer.toString("utf8");
  assert(content.includes("scripts\\run.ps1"), `${launcher} 入口无效。`);
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] === 0x0a) {
      assert(
        index > 0 && buffer[index - 1] === 0x0d,
        `${launcher} 必须使用 Windows CRLF 换行。`,
      );
    }
  }
}

assert(
  packageJson.scripts.cleanup === "node src/cli.mjs cleanup",
  "缺少安全缓存清理命令。",
);
assert(
  packageJson.scripts.purge === "node src/cli.mjs purge",
  "缺少完全卸载命令。",
);
assert(
  packageJson.scripts["collect:compatibility"] ===
    "node scripts/collect-compatibility-candidate.mjs",
  "缺少兼容性候选采集命令。",
);
assert(
  packageJson.scripts["compatibility:sign"] ===
    "node scripts/sign-compatibility-manifest.mjs" &&
    packageJson.scripts["compatibility:verify"] ===
      "node scripts/verify-remote-compatibility.mjs",
  "缺少远程兼容性签名或验证命令。",
);
assert(
  packageJson.scripts["release:notes"] ===
    "node scripts/generate-release-notes.mjs",
  "缺少 Release 兼容版本说明生成命令。",
);
assert(
  packageJson.scripts["build:portable"]?.includes("build-portable.ps1"),
  "缺少便携发布包构建命令。",
);

const runScript = await readFile(
  path.join(projectRoot, "scripts", "run.ps1"),
  "utf8",
);
assert(
  runScript.includes("runtime\\node.exe") &&
    runScript.includes("Cleanup") &&
    runScript.includes("Purge"),
  "PowerShell 入口未支持便携运行时、缓存清理或完全卸载。",
);

for (const script of ["run.ps1", "build-portable.ps1"]) {
  const buffer = await readFile(path.join(projectRoot, "scripts", script));
  assert(
    buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf,
    `${script} 必须使用带 BOM 的 UTF-8，确保 Windows PowerShell 5.1 正确读取中文。`,
  );
}

for (const workflow of ["ci.yml", "release.yml"]) {
  const workflowPath = path.join(projectRoot, ".github", "workflows", workflow);
  const content = await readFile(workflowPath, "utf8");
  assert(content.includes("npm test"), `${workflow} 未运行单元测试。`);
  assert(content.includes("npm run validate"), `${workflow} 未运行项目校验。`);
}
const releaseWorkflow = await readFile(
  path.join(projectRoot, ".github", "workflows", "release.yml"),
  "utf8",
);
assert(
  releaseWorkflow.includes("generate-release-notes.mjs") &&
    releaseWorkflow.includes("--notes $releaseNotes"),
  "Release 工作流没有自动附加兼容版本说明。",
);

const portableScript = await readFile(
  path.join(projectRoot, "scripts", "build-portable.ps1"),
  "utf8",
);
assert(
  portableScript.includes("SHASUMS256.txt") &&
    portableScript.includes("NODE_LICENSE"),
  "便携包没有验证官方 Node.js 下载或携带 Node 许可证。",
);

const moduleFiles = (await collectFiles(projectRoot)).filter((filePath) =>
  filePath.endsWith(".mjs"),
);
for (const moduleFile of moduleFiles) {
  const result = spawnSync(process.execPath, ["--check", moduleFile], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert(
    result.status === 0,
    `${path.relative(projectRoot, moduleFile)} 语法检查失败：${result.stderr}`,
  );
}

const remoteCompatibilityValidation = spawnSync(
  process.execPath,
  [path.join(projectRoot, "scripts", "verify-remote-compatibility.mjs")],
  { encoding: "utf8", windowsHide: true, cwd: projectRoot },
);
assert(
  remoteCompatibilityValidation.status === 0,
  `远程兼容性签名验证失败：${remoteCompatibilityValidation.stderr}`,
);

console.log(`兼容目标: ${compatibility.targets.length}`);
console.log(
  `DOM 翻译: ${Object.keys(dictionary.exact).length} 条精确规则 + ${dictionary.patterns.length} 条动态规则`,
);
console.log(`JavaScript 模块语法检查: ${moduleFiles.length}`);
console.log("项目结构验证通过。");
