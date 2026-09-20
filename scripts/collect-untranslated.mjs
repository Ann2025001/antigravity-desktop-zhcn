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
} else {
  const port = await findLatestUiPort();
  if (port) {
    try {
      uiBundleBuffer = await fetchUiBundle(port);
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

// If UI bundle is available, extract static UI candidates from clean string literals
if (uiBundleBuffer) {
  const bundleText = uiBundleBuffer.toString("utf8");
  // Match single or double quoted strings of 2-80 characters
  const stringLiteralRegex = /"([^"\r\n]{2,80})"|'([^'\r\n]{2,80})'/g;
  let match;
  while ((match = stringLiteralRegex.exec(bundleText)) !== null) {
    const candidate = (match[1] || match[2] || "").trim();
    if (!candidate) continue;

    // Strict UI heuristics for static bundle literals:
    // Must start with an uppercase letter or special UI symbol
    if (!/^[A-Z][a-zA-Z0-9\s.,'?!()-]{1,80}$/.test(candidate)) continue;

    // Filter out common JS keywords, identifiers, and camelCase
    if (
      /^[A-Z][a-z0-9]+[A-Z]/.test(candidate) ||
      candidate.includes("http") ||
      candidate.includes("TypeError") ||
      candidate.includes("Error") ||
      candidate.includes("Object") ||
      candidate.includes("Array") ||
      candidate.includes("Promise") ||
      candidate.includes("Function") ||
      candidate.includes("Undefined") ||
      candidate.includes("Null")
    ) {
      continue;
    }

    if (isPotentialEnglishUi(candidate, { tagName: "STATIC_BUNDLE" })) {
      collector.record({
        text: candidate,
        tagName: "bundle",
        contextPath: "runtime/main.js",
      });
    }
  }
}

const now = new Date();
const dateStr = now.toISOString().replace(/[:.]/g, "-");
const outputDir = explicitOutputDir
  ? path.resolve(explicitOutputDir)
  : path.join(projectRoot, "reports");

const jsonReport = collector.generateJsonReport({ generatedAt: now.toISOString() });
const mdReport = collector.generateMarkdownReport({ generatedAt: now.toISOString() });

await mkdir(outputDir, { recursive: true });

const jsonPath = path.join(outputDir, `untranslated-${appVersion}-${dateStr}.json`);
const mdPath = path.join(outputDir, `untranslated-${appVersion}-${dateStr}.md`);

await writeFile(jsonPath, JSON.stringify(jsonReport, null, 2) + "\n", "utf8");
await writeFile(mdPath, mdReport, "utf8");

console.log(`\n=== 未翻译英文 UI 采集完成 ===`);
console.log(`客户端版本: ${appVersion}`);
console.log(`未翻译候选总数: ${jsonReport.totalCandidates}`);
console.log(`JSON 报告: ${jsonPath}`);
console.log(`Markdown 报告: ${mdPath}`);
console.log(`注意: 报告已生成在 reports/ 目录，仅供维护者与贡献者审阅，不会被 Git 默认跟踪。`);
