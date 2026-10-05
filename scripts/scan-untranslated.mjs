import fs from "node:fs";
import path from "node:path";

const bundlePath = "C:/Users/MI/AppData/Roaming/Antigravity/agy_zhcn_ui_main.js";
const code = fs.readFileSync(bundlePath, "utf8");
const dict = JSON.parse(fs.readFileSync("config/dom-translations.json", "utf8"));

// 编译动态正则
const compiledPatterns = dict.patterns.map((p) => ({
  reg: new RegExp(p.source, p.flags),
  target: p.target,
}));

function isCovered(str) {
  const trimmed = str.trim();
  if (dict.exact[trimmed] !== undefined) return true;
  for (const { reg } of compiledPatterns) {
    reg.lastIndex = 0;
    if (reg.test(trimmed)) return true;
  }
  return false;
}

const candidates = new Set();

// 1. 属性匹配: label, title, description, subtitle, emptyText, placeholder, message, tooltip
const attrRegex =
  /\b(?:label|title|description|subtitle|emptyText|placeholder|message|tooltipContent|subtext|upgradeButtonText)\s*:\s*"([A-Za-z][a-zA-Z0-9\s,.'!?:;\-_/()]{2,150})"/g;
let m;
while ((m = attrRegex.exec(code)) !== null) {
  candidates.add(m[1].trim());
}

// 2. createElement 文本子节点: z.createElement("tag", ..., "Text")
const elementRegex =
  /z\.createElement\("[a-zA-Z0-9_-]+"\s*,\s*(?:null|\{[^}]*\})\s*,\s*"([A-Za-z][a-zA-Z0-9\s,.'!?:;\-_/()]{2,150})"/g;
while ((m = elementRegex.exec(code)) !== null) {
  candidates.add(m[1].trim());
}

// 3. 常见独立英文长句 / UI 描述
const sentenceRegex = /"([A-Z][a-zA-Z0-9\s,.'!?/()-]{10,120}\.)"/g;
while ((m = sentenceRegex.exec(code)) !== null) {
  candidates.add(m[1].trim());
}

console.log("候选提取文本总数:", candidates.size);

const unCovered = [];
for (const cand of candidates) {
  // 过滤代码/文件名/技术标识
  if (
    cand.includes("http://") ||
    cand.includes("https://") ||
    cand.includes("className") ||
    cand.includes("node_modules") ||
    cand.endsWith(".js") ||
    cand.endsWith(".css") ||
    cand.endsWith(".ts") ||
    cand.endsWith(".tsx") ||
    cand.endsWith(".json") ||
    cand.endsWith(".png") ||
    cand.endsWith(".svg")
  ) {
    continue;
  }
  if (/^[A-Z0-9_]+$/.test(cand) && cand.length > 12) continue; // 大写常量
  if (/^[a-z]+[A-Z0-9]/.test(cand)) continue; // camelCase
  if (cand.startsWith("utm_") || cand.startsWith("antigravity-")) continue;
  if (/^[\d\s.,:;\/\-_=+*#%()[\]{}'"><&|!~`^$]+$/.test(cand)) continue;

  if (!isCovered(cand)) {
    unCovered.push(cand);
  }
}

console.log("未覆盖且为有效 UI 文本的数量:", unCovered.length);
fs.writeFileSync(
  "scripts/uncovered-ui.json",
  JSON.stringify(unCovered.sort(), null, 2),
  "utf8"
);
console.log("前 30 条未覆盖示例:");
unCovered.slice(0, 30).forEach((s) => console.log(" -", s));
