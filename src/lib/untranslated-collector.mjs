import { translateDictionaryValue } from "./translator.mjs";

const BLOCKED_DOM_CONTAINER_REGEX =
  /(?:^|\s)(?:script|style|code|pre|textarea|input|monaco-editor|xterm|terminal|message|chat|conversation|turn|thinking|thought|log)(?:\s|$|[-_])/i;

const SENSITIVE_TECH_PATTERNS = [
  // URLs & protocols
  /^(?:https?|file|agy|ws|wss|vscode|chrome-extension):\/\//i,
  /\b(?:localhost|127\.0\.0\.1)(?::\d+)?\b/i,
  /\b(?:github\.com|google\.com|npmjs\.com)\b/i,
  // File paths (Windows, Unix, relative)
  /^[a-zA-Z]:[\\\/]/,
  /^\/[a-zA-Z0-9_\-\.]+/,
  /^\.\.?[\\\/]/,
  /\.(?:exe|dll|asar|js|mjs|cjs|json|md|py|sh|ps1|log|png|jpg|jpeg|svg|css|html|ts|tsx|map|node|tmp|bak)$/i,
  // CLI / Shell commands
  /^(?:npm|npx|git|node|powershell|cmd|cat|grep|ls|cd|rm|cp|mv|echo|curl|chmod|pnpm|yarn|agy)\b/i,
  /\s--[a-z0-9-]+|\s-[a-z0-9]/i,
  // Code tokens & JSON / AST structures
  /=>|\bfunction\s*\(|\b(?:const|let|var|import|export|class|return|async|await)\b/,
  /[{}\[\]\|\\<>=]/,
  /===|!==|\bconsole\.(?:log|error|warn)\b/,
  /^(?:use client|use strict)$/i,
  // CSS & Tailwind class tokens
  /\b(?:text|bg|border|flex|items|justify|gap|rounded|hover|focus|font|w-|h-|p-|m-|opacity|space-|shrink|grow|truncate|z-)[a-z0-9]/i,
  // Keyboard keys / DOM Event strings
  /^(?:click|enter|select|input|change|keyup|keydown|blur|focus|ArrowDown|ArrowUp|ArrowLeft|ArrowRight|Backspace|End|Home|Escape|Tab|Space|Enter)$/i,
  // Hashes, UUIDs, Tokens, API Keys
  /^[0-9a-fA-F]{8,64}$/,
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  /^sk-[a-zA-Z0-9_-]{16,}/,
  /^AIza[0-9A-Za-z-_]{35}/,
  // Keyboard shortcuts & raw identifiers
  /^(?:Ctrl|Alt|Shift|Cmd|Win|Meta)\s*\+\s*[A-Z0-9]$/i,
  /^F\d{1,2}$/i,
  // Pure digits and symbols
  /^[\d\s.,:;\/\-_=+*#%()[\]{}'"><&|!~`^$]+$/,
];

const PRESERVED_ENGLISH_SET = new Set([
  "GOOGLE3",
  "CIDER",
  "WEBGL",
  "HTTP",
  "JSON",
  "UUID",
  "SHA256",
  "API",
  "IDE",
  "MCP",
  "GITHUB",
  "GEMINI",
  "ANTIGRAVITY",
  "URL",
  "TOKEN",
  "UNSPECIFIED",
  "AS IS",
  "SOFTWARE",
  "CLOSED",
  "ERROR",
]);

const ALLOWED_UI_TAGS = new Set([
  "BUTTON",
  "LABEL",
  "TH",
  "DT",
  "OPTION",
  "SUMMARY",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "SPAN",
  "DIV",
  "P",
  "LI",
]);

const ALLOWED_UI_ROLES = new Set([
  "button",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "dialog",
  "tooltip",
  "alert",
  "status",
  "checkbox",
  "radio",
  "heading",
  "option",
  "menu",
  "listbox",
  "combobox",
  "popover",
]);

const ALLOWED_UI_ATTRIBUTES = new Set([
  "aria-label",
  "title",
  "placeholder",
  "tooltip",
  "data-tooltip",
]);

export function isPotentialEnglishUi(text, context = {}) {
  if (typeof text !== "string") return false;
  const core = text.trim();
  if (core.length < 2 || core.length > 300) return false;

  // Must contain English letters
  if (!/[a-zA-Z]/.test(core)) return false;

  // Must NOT contain Chinese characters (already translated or user-provided Chinese)
  if (/[\u4e00-\u9fff]/.test(core)) return false;

  // Check technical / sensitive patterns
  for (const pattern of SENSITIVE_TECH_PATTERNS) {
    if (pattern.test(core)) return false;
  }

  // If DOM context is provided, validate UI containers and reject sensitive contexts
  const {
    tagName = "",
    role = "",
    attributeName = "",
    closestSelectors = [],
    isUserInput = false,
    isModelOutput = false,
    isBundleScan = false,
  } = context;

  if (isUserInput || isModelOutput) return false;

  for (const selector of closestSelectors) {
    if (BLOCKED_DOM_CONTAINER_REGEX.test(selector)) {
      return false;
    }
  }

  if (attributeName && !ALLOWED_UI_ATTRIBUTES.has(attributeName.toLowerCase())) {
    return false;
  }

  // Static bundle scan pass
  if (isBundleScan || tagName === "STATIC_BUNDLE" || tagName === "BUNDLE") {
    return true;
  }

  if (!attributeName) {
    const upperTag = tagName.toUpperCase();
    const lowerRole = role.toLowerCase();
    const isExplicitUiTag =
      upperTag === "BUTTON" ||
      upperTag === "LABEL" ||
      upperTag === "TH" ||
      upperTag === "DT" ||
      upperTag === "OPTION" ||
      upperTag === "SUMMARY" ||
      /^H[1-6]$/.test(upperTag);
    const isExplicitUiRole = ALLOWED_UI_ROLES.has(lowerRole);
    const inUiContainer = closestSelectors.some((s) =>
      /(?:dialog|modal|settings|toolbar|nav|menu|popup|popover|dropdown|listbox|portal|toast|alert|sidebar|header|form|tooltip)/i.test(
        s,
      ),
    );

    // If tag is generic span/div/p/li, require explicit UI role or UI container
    if (!isExplicitUiTag && !isExplicitUiRole && !inUiContainer) {
      return false;
    }
  }

  return true;
}

export function classifyCandidateCategory(text) {
  const upper = text.trim().toUpperCase();
  if (PRESERVED_ENGLISH_SET.has(upper) || /^[A-Z0-9_-]{2,12}$/.test(text)) {
    return "preserved-english";
  }
  if (
    text.length > 30 ||
    /^(?:Select|Please|Describe|Click|Enter|Attach|Use|For|Are you|How|What|Manage|Configure|Enable|Disable)\b/i.test(
      text,
    )
  ) {
    return "high-confidence-ui";
  }
  if (/^[A-Z][a-zA-Z0-9\s.,'?!()-]{2,40}$/.test(text)) {
    return "high-confidence-ui";
  }
  return "needs-human-review";
}

export function classifyTextCoverage(text, dictionary) {
  if (typeof text !== "string" || !dictionary) {
    return { status: "untranslated", translated: null };
  }
  const core = text.trim();
  if (dictionary.exact && dictionary.exact[core] !== undefined) {
    return {
      status: "exact-covered",
      translated: dictionary.exact[core],
    };
  }
  const translated = translateDictionaryValue(core, dictionary);
  if (translated !== null && translated !== core) {
    // Strip safely preserved variables (quoted tokens, URLs, emails, paths) from translated string
    const cleaned = translated
      .replace(/[“"'][^”"']+[”"']/g, "")
      .replace(/`[^`]+`/g, "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g, "")
      .replace(/[a-zA-Z]:[\\\/]\S+/g, "")
      .trim();

    // If remaining text still contains standalone English words (e.g. "新建 Project"),
    // flag as partial-untranslated
    if (/[\u4e00-\u9fff]/.test(cleaned) && /\b[a-zA-Z]{2,}\b/.test(cleaned)) {
      return {
        status: "partial-untranslated",
        translated,
      };
    }
    return {
      status: "pattern-covered",
      translated,
    };
  }
  return {
    status: "untranslated",
    translated: null,
  };
}

export class UntranslatedCollector {
  constructor({ dictionary = null, appVersion = "unknown" } = {}) {
    this.dictionary = dictionary;
    this.appVersion = appVersion;
    this.records = new Map();
  }

  record({
    text,
    tagName = "",
    role = "",
    attributeName = "",
    contextPath = "",
    closestSelectors = [],
    isUserInput = false,
    isModelOutput = false,
    isBundleScan = false,
    sourceType = "runtime-dom",
  }) {
    if (
      !isPotentialEnglishUi(text, {
        tagName,
        role,
        attributeName,
        closestSelectors,
        isUserInput,
        isModelOutput,
        isBundleScan,
      })
    ) {
      return false;
    }

    const core = text.trim();
    const coverage = classifyTextCoverage(core, this.dictionary);
    const category = classifyCandidateCategory(core);

    const existing = this.records.get(core);
    if (existing) {
      existing.count += 1;
      existing.lastSeen = new Date().toISOString();
      if (tagName) existing.elementTypes.add(tagName.toLowerCase());
      if (role) existing.roles.add(role.toLowerCase());
      if (attributeName) existing.attributes.add(attributeName.toLowerCase());
      if (contextPath) existing.contexts.add(contextPath);
      if (sourceType) existing.sources.add(sourceType);
    } else {
      this.records.set(core, {
        text: core,
        count: 1,
        status: coverage.status,
        category,
        translated: coverage.translated,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        elementTypes: new Set(tagName ? [tagName.toLowerCase()] : []),
        roles: new Set(role ? [role.toLowerCase()] : []),
        attributes: new Set(attributeName ? [attributeName.toLowerCase()] : []),
        contexts: new Set(contextPath ? [contextPath] : []),
        sources: new Set(sourceType ? [sourceType] : []),
      });
    }
    return true;
  }

  getCandidates({ status = "all-untranslated", category = null } = {}) {
    const list = [];
    for (const record of this.records.values()) {
      let statusMatch = false;
      if (status === "all-untranslated") {
        statusMatch =
          record.status === "untranslated" ||
          record.status === "partial-untranslated";
      } else if (!status || record.status === status) {
        statusMatch = true;
      }
      const categoryMatch = !category || record.category === category;

      if (statusMatch && categoryMatch) {
        list.push({
          text: record.text,
          count: record.count,
          status: record.status,
          category: record.category,
          translated: record.translated,
          firstSeen: record.firstSeen,
          lastSeen: record.lastSeen,
          elementTypes: [...record.elementTypes].sort(),
          roles: [...record.roles].sort(),
          attributes: [...record.attributes].sort(),
          contexts: [...record.contexts].sort(),
          sources: [...record.sources].sort(),
        });
      }
    }
    return list.sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
  }

  getStatistics() {
    let untranslated = 0;
    let partialUntranslated = 0;
    let exactCovered = 0;
    let patternCovered = 0;

    for (const record of this.records.values()) {
      if (record.status === "untranslated") untranslated += 1;
      else if (record.status === "partial-untranslated") partialUntranslated += 1;
      else if (record.status === "exact-covered") exactCovered += 1;
      else if (record.status === "pattern-covered") patternCovered += 1;
    }

    return {
      totalRecorded: this.records.size,
      untranslated,
      partialUntranslated,
      exactCovered,
      patternCovered,
    };
  }

  generateJsonReport({
    generatedAt = new Date().toISOString(),
    filterStatus = "all-untranslated",
    scanSource = "runtime-dom",
  } = {}) {
    const candidates = this.getCandidates({ status: filterStatus });
    const stats = this.getStatistics();
    return {
      schemaVersion: 1,
      type: "untranslated-ui-report",
      appVersion: this.appVersion,
      generatedAt,
      scanSource,
      filterStatus,
      statistics: stats,
      totalCandidates: candidates.length,
      candidates,
    };
  }

  generateMarkdownReport({
    generatedAt = new Date().toISOString(),
    filterStatus = "all-untranslated",
    scanSource = "runtime-dom",
  } = {}) {
    const highConf = this.getCandidates({
      status: filterStatus,
      category: "high-confidence-ui",
    });
    const needsReview = this.getCandidates({
      status: filterStatus,
      category: "needs-human-review",
    });
    const preserved = this.getCandidates({
      status: filterStatus,
      category: "preserved-english",
    });
    const stats = this.getStatistics();

    const lines = [
      `# Antigravity 2.15.0 UI Localization Audit Report`,
      "",
      `- **客户端版本**: ${this.appVersion}`,
      `- **生成时间**: ${generatedAt}`,
      `- **采集来源**: ${scanSource}`,
      `- **覆盖统计**: Exact 覆盖 \`${stats.exactCovered}\` 项 | Pattern 覆盖 \`${stats.patternCovered}\` 项 | 完全未翻译 \`${stats.untranslated}\` 项 | 半中文残留 \`${stats.partialUntranslated}\` 项`,
      "",
      "> [!NOTE]",
      "> 此报告由维护者采集工具自动生成。已分类为【高置信度固定 UI】、【需要人工判断】与【应保留英文】，仅供词库维护与社区贡献参考。",
      "",
      "## 一、高置信度固定 UI 候选 (High-Confidence UI)",
      "",
      "| 序号 | 频次 | 状态 | 原始英文 UI 文本 | 来源 / 元素类型 | 建议汉化 |",
      "| :---: | :---: | :---: | :--- | :--- | :--- |",
    ];

    if (highConf.length === 0) {
      lines.push("| - | 0 | - | *(无高置信度未翻译 UI)* | - | - |");
    } else {
      highConf.slice(0, 50).forEach((c, idx) => {
        const types = [
          ...c.sources,
          ...c.elementTypes,
          ...c.roles.map((r) => `role=${r}`),
          ...c.attributes.map((a) => `@${a}`),
        ].join(", ") || "text";
        const trans = c.translated ? `(当前: \`${c.translated.replace(/\|/g, "\\|")}\`)` : "";
        lines.push(`| ${idx + 1} | ${c.count} | \`${c.status}\` | \`${c.text.replace(/\|/g, "\\|")}\` | \`${types}\` | ${trans} |`);
      });
    }

    lines.push("", "## 二、需要人工判断的词条 (Needs Human Review)", "");
    lines.push("| 序号 | 频次 | 状态 | 原始英文 UI 文本 | 来源 / 元素类型 | 备注 |");
    lines.push("| :---: | :---: | :---: | :--- | :--- | :--- |");
    if (needsReview.length === 0) {
      lines.push("| - | 0 | - | *(无)* | - | - |");
    } else {
      needsReview.slice(0, 50).forEach((c, idx) => {
        const types = [
          ...c.sources,
          ...c.elementTypes,
          ...c.roles.map((r) => `role=${r}`),
        ].join(", ") || "text";
        lines.push(`| ${idx + 1} | ${c.count} | \`${c.status}\` | \`${c.text.replace(/\|/g, "\\|")}\` | \`${types}\` | |`);
      });
    }

    lines.push("", "## 三、建议保留英文的词条 (Preserved Technical / Brand Names)", "");
    lines.push("| 序号 | 频次 | 标识符 / 术语 | 建议保留原因 |");
    lines.push("| :---: | :---: | :--- | :--- |");
    if (preserved.length === 0) {
      lines.push("| - | 0 | *(无)* | - |");
    } else {
      preserved.slice(0, 30).forEach((c, idx) => {
        lines.push(`| ${idx + 1} | ${c.count} | \`${c.text.replace(/\|/g, "\\|")}\` | 官方术语 / 协议 / 代码标识符 |`);
      });
    }

    lines.push("");
    return lines.join("\n");
  }
}
