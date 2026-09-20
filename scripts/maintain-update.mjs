import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectInstallation,
} from "../src/lib/installation.mjs";
import {
  collectCompatibilityCandidate,
} from "../src/lib/compatibility-candidate.mjs";
import {
  fetchUiBundle,
  findLatestUiPort,
} from "../src/lib/runtime-bundle.mjs";
import {
  loadDomTranslations,
} from "../src/lib/translator.mjs";
import {
  UntranslatedCollector,
  isPotentialEnglishUi,
} from "../src/lib/untranslated-collector.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

console.log("============================================================");
console.log("        Antigravity 新版本自动适配与 UI 扫描工作流");
console.log("============================================================\n");

// 1. Inspect local client installation
console.log("[1/4] 检查本地 Antigravity 安装与指纹状态...");
const inspection = await inspectInstallation();
console.log(`- 客户端路径: ${inspection.installRoot}`);
console.log(`- 检测版本号: ${inspection.packageVersion}`);
console.log(`- app.asar SHA256: ${inspection.appAsarSha256}`);

if (inspection.target) {
  console.log(`- 兼容性状态: 当前版本构建已在兼容白名单中。`);
} else {
  console.log(`- 兼容性状态: 未知版本/构建，准备生成候选指纹...`);
}

// 2. Fetch live runtime UI bundle
console.log("\n[2/4] 获取运行时 UI bundle...");
const port = await findLatestUiPort();
if (!port) {
  throw new Error("未找到运行中的 Antigravity UI 端口，请先启动 Antigravity Desktop。");
}
console.log(`- 检测到 UI 端口: ${port}`);
const uiBundleBuffer = await fetchUiBundle(port);
console.log(`- 成功拉取 main.js (${uiBundleBuffer.length} bytes)`);

// 3. Generate compatibility candidate if unverified
let candidatePath = null;
if (!inspection.target) {
  console.log("\n[3/4] 正在生成版本兼容性候选数据 (Candidate)...");
  const appAsarPath = path.join(inspection.installRoot, "resources", "app.asar");
  const targetCandidate = await collectCompatibilityCandidate({
    appAsarPath,
    uiBundle: uiBundleBuffer,
  });

  const candidateDir = path.join(projectRoot, ".runtime", "compatibility-candidates");
  await mkdir(candidateDir, { recursive: true });
  candidatePath = path.join(
    candidateDir,
    `${targetCandidate.appVersion}-${targetCandidate.platform}-${targetCandidate.arch}.json`,
  );
  const doc = {
    schemaVersion: 1,
    status: "candidate",
    generatedAt: new Date().toISOString(),
    source: {
      installRoot: inspection.installRoot,
      appAsarPath,
      uiSource: `https://127.0.0.1:${port}/main.js`,
    },
    target: targetCandidate,
  };
  await writeFile(candidatePath, JSON.stringify(doc, null, 2) + "\n", "utf8");
  console.log(`- 已生成候选文件: ${candidatePath}`);
} else {
  console.log("\n[3/4] 跳过候选生成（当前构建已收录）。");
}

// 4. Run Untranslated & Partial-Untranslated Collector
console.log("\n[4/4] 扫描未翻译/半中文英文 UI 词条...");
const dictionary = await loadDomTranslations();
const collector = new UntranslatedCollector({
  dictionary,
  appVersion: inspection.packageVersion,
});

const bundleText = uiBundleBuffer.toString("utf8");

// Extract high-confidence UI descriptors
const uiKeyRegex =
  /(?:label|tooltipText|tooltipContent|title|placeholder|heading|buttonText|ariaLabel|copyLabel|settingsLabel|archiveLabel|searchPlaceholder)\s*:\s*(?:[a-zA-Z0-9_$]+\s*\?\?\s*)?["']([^"'\r\n]{2,300})["']/g;
let match;
while ((match = uiKeyRegex.exec(bundleText)) !== null) {
  const candidate = match[1].trim();
  if (
    isPotentialEnglishUi(candidate, {
      isBundleScan: true,
      tagName: "UI_DESCRIPTOR",
    })
  ) {
    collector.record({
      text: candidate,
      tagName: "descriptor",
      sourceType: "bundle-descriptor",
      contextPath: "bundle:uiKey",
      isBundleScan: true,
    });
  }
}

// Extract string literals
const stringLiteralRegex = /"([^"\r\n]{2,200})"|'([^'\r\n]{2,200})'/g;
while ((match = stringLiteralRegex.exec(bundleText)) !== null) {
  const candidate = (match[1] || match[2] || "").trim();
  if (!candidate) continue;

  if (
    candidate.includes("TypeError") ||
    candidate.includes("Error:") ||
    candidate.includes("Object.") ||
    candidate.includes("Array.") ||
    candidate.includes("Promise.") ||
    candidate.includes("Function.") ||
    candidate.includes("WebGL") ||
    candidate.includes("HTTP") ||
    candidate.includes("JSON")
  ) {
    continue;
  }

  if (
    isPotentialEnglishUi(candidate, {
      isBundleScan: true,
      tagName: "STATIC_BUNDLE",
    })
  ) {
    collector.record({
      text: candidate,
      tagName: "literal",
      sourceType: "bundle-literal",
      contextPath: "bundle:main.js",
      isBundleScan: true,
    });
  }
}

const now = new Date();
const dateStr = now.toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(projectRoot, "reports");
await mkdir(outputDir, { recursive: true });

const jsonPath = path.join(outputDir, `untranslated-${inspection.packageVersion}-${dateStr}.json`);
const mdPath = path.join(outputDir, `untranslated-${inspection.packageVersion}-${dateStr}.md`);

const jsonReport = collector.generateJsonReport({
  generatedAt: now.toISOString(),
  scanSource: `live-runtime-bundle (https://127.0.0.1:${port}/main.js)`,
});
const mdReport = collector.generateMarkdownReport({
  generatedAt: now.toISOString(),
  scanSource: `live-runtime-bundle (https://127.0.0.1:${port}/main.js)`,
});

await writeFile(jsonPath, JSON.stringify(jsonReport, null, 2) + "\n", "utf8");
await writeFile(mdPath, mdReport, "utf8");

const stats = jsonReport.statistics;
console.log("\n============================================================");
console.log("                     适配与审计结果汇总");
console.log("============================================================");
console.log(`- Exact 规则覆盖: ${stats.exactCovered}`);
console.log(`- Pattern 规则覆盖: ${stats.patternCovered}`);
console.log(`- 未翻译候选总数: ${stats.untranslated}`);
console.log(`- 半中文残留候选: ${stats.partialUntranslated}`);
console.log(`- Markdown 审计报告: ${mdPath}`);
if (candidatePath) {
  console.log(`- 兼容性候选指纹: ${candidatePath}`);
}
console.log("\n【维护者后续操作清单 Checklist】:");
console.log("1. 审阅 reports/ 目录中生成的 Markdown 审计报告；");
console.log("2. 将需要补充或更新的中文词条加入 config/dom-translations.json；");
console.log("3. 运行 npm test 与 npm run validate 确保全部校验通过；");
console.log("4. 执行实机安装与恢复验证；");
console.log(`5. 将验证通过的指纹移动至 config/compatibility/${inspection.packageVersion}/win32-x64.json；`);
console.log("6. 提交 Git 变更并发布新版本便携包。");
console.log("============================================================\n");
