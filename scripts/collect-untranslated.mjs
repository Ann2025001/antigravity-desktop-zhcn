import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDomTranslations } from "../src/lib/translator.mjs";
import {
  UntranslatedCollector,
  isPotentialEnglishUi,
} from "../src/lib/untranslated-collector.mjs";
import {
  fetchUiBundle,
  findLatestUiPort,
} from "../src/lib/runtime-bundle.mjs";
import { inspectInstallation } from "../src/lib/installation.mjs";

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

const explicitUiPath = readOption("--ui-bundle");
const explicitVersion = readOption("--app-version");
const explicitOutputDir = readOption("--output-dir");

let appVersion = explicitVersion || "unknown";
let uiBundleBuffer = null;
let scanSource = "offline-bundle";

try {
  const inspection = await inspectInstallation();
  if (inspection?.packageVersion) {
    appVersion = inspection.packageVersion;
  }
} catch {
  // Optional if running standalone
}

if (explicitUiPath) {
  uiBundleBuffer = await readFile(path.resolve(explicitUiPath));
  scanSource = `offline-bundle (${path.basename(explicitUiPath)})`;
} else {
  const port = await findLatestUiPort();
  if (port) {
    try {
      uiBundleBuffer = await fetchUiBundle(port);
      scanSource = `live-runtime-bundle (https://127.0.0.1:${port}/main.js)`;
    } catch {
      // Live fetch fallback
    }
  }
}

const dictionary = await loadDomTranslations();
const collector = new UntranslatedCollector({
  dictionary,
  appVersion,
});

if (uiBundleBuffer) {
  const bundleText = uiBundleBuffer.toString("utf8");

  // 1. Comprehensive UI descriptor regex (capturing keys like tooltipText, label, title, copyLabel, etc.)
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

  // 2. Help texts & UI string literals scan
  const stringLiteralRegex = /"([^"\r\n]{2,200})"|'([^'\r\n]{2,200})'/g;
  while ((match = stringLiteralRegex.exec(bundleText)) !== null) {
    const candidate = (match[1] || match[2] || "").trim();
    if (!candidate) continue;

    // Reject non-UI code / internal identifiers
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
}

const now = new Date();
const dateStr = now.toISOString().replace(/[:.]/g, "-");
const outputDir = explicitOutputDir
  ? path.resolve(explicitOutputDir)
  : path.join(projectRoot, "reports");

const jsonReport = collector.generateJsonReport({
  generatedAt: now.toISOString(),
  scanSource,
  filterStatus: "all-untranslated",
});
const mdReport = collector.generateMarkdownReport({
  generatedAt: now.toISOString(),
  scanSource,
  filterStatus: "all-untranslated",
});

await mkdir(outputDir, { recursive: true });

const jsonPath = path.join(outputDir, `untranslated-${appVersion}-${dateStr}.json`);
const mdPath = path.join(outputDir, `untranslated-${appVersion}-${dateStr}.md`);

await writeFile(jsonPath, JSON.stringify(jsonReport, null, 2) + "\n", "utf8");
await writeFile(mdPath, mdReport, "utf8");

const stats = jsonReport.statistics;
console.log(`\n=== Antigravity 2.15.0 UI 采集与审计完成 ===`);
console.log(`客户端版本: ${appVersion}`);
console.log(`采集来源: ${scanSource}`);
console.log(`词典覆盖统计: Exact [${stats.exactCovered}] | Pattern [${stats.patternCovered}] | 未翻译 [${stats.untranslated}] | 半中文 [${stats.partialUntranslated}]`);
console.log(`未翻译候选总数: ${jsonReport.totalCandidates}`);
console.log(`JSON 报告: ${jsonPath}`);
console.log(`Markdown 审计报告: ${mdPath}`);
console.log(`注意: 报告已生成在 reports/ 目录（已被 .gitignore 忽略）。`);
