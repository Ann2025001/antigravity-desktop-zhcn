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
  // Code tokens & JSON structures
  /=>|\bfunction\s*\(|\b(?:const|let|var|import|export|class|return|async|await)\b/,
  /^\s*\{.*\}\s*$/,
  /^\s*\[.*\]\s*$/,
  /===|!==|\bconsole\.(?:log|error|warn)\b/,
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
]);

const ALLOWED_UI_ROLES = new Set([
  "button",
  "menuitem",
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
]);

const ALLOWED_UI_ATTRIBUTES = new Set(["aria-label", "title", "placeholder"]);

export function isPotentialEnglishUi(text, context = {}) {
  if (typeof text !== "string") return false;
  const core = text.trim();
  if (core.length < 2 || core.length > 120) return false;

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

  if (!attributeName) {
    const upperTag = tagName.toUpperCase();
    const lowerRole = role.toLowerCase();
    const isExplicitUiTag = ALLOWED_UI_TAGS.has(upperTag);
    const isExplicitUiRole = ALLOWED_UI_ROLES.has(lowerRole);
    const inUiContainer = closestSelectors.some((s) =>
      /(?:dialog|modal|settings|toolbar|nav|menu|popup|toast|alert|sidebar|header)/i.test(
        s,
      ),
    );

    // Reject raw paragraphs or generic div/span outside recognized UI containers
    if (!isExplicitUiTag && !isExplicitUiRole && !inUiContainer) {
      return false;
    }
  }

  return true;
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
  }) {
    if (
      !isPotentialEnglishUi(text, {
        tagName,
        role,
        attributeName,
        closestSelectors,
        isUserInput,
        isModelOutput,
      })
    ) {
      return false;
    }

    const core = text.trim();
    const coverage = classifyTextCoverage(core, this.dictionary);

    const existing = this.records.get(core);
    if (existing) {
      existing.count += 1;
      existing.lastSeen = new Date().toISOString();
      if (tagName) existing.elementTypes.add(tagName.toLowerCase());
      if (role) existing.roles.add(role.toLowerCase());
      if (attributeName) existing.attributes.add(attributeName.toLowerCase());
      if (contextPath) existing.contexts.add(contextPath);
    } else {
      this.records.set(core, {
        text: core,
        count: 1,
        status: coverage.status,
        translated: coverage.translated,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        elementTypes: new Set(tagName ? [tagName.toLowerCase()] : []),
        roles: new Set(role ? [role.toLowerCase()] : []),
        attributes: new Set(attributeName ? [attributeName.toLowerCase()] : []),
        contexts: new Set(contextPath ? [contextPath] : []),
      });
    }
    return true;
  }

  getCandidates({ status = "untranslated" } = {}) {
    const list = [];
    for (const record of this.records.values()) {
      if (!status || record.status === status) {
        list.push({
          text: record.text,
          count: record.count,
          status: record.status,
          translated: record.translated,
          firstSeen: record.firstSeen,
          lastSeen: record.lastSeen,
          elementTypes: [...record.elementTypes].sort(),
          roles: [...record.roles].sort(),
          attributes: [...record.attributes].sort(),
          contexts: [...record.contexts].sort(),
        });
      }
    }
    return list.sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
  }

  generateJsonReport({
    generatedAt = new Date().toISOString(),
    filterStatus = "untranslated",
  } = {}) {
    const candidates = this.getCandidates({ status: filterStatus });
    return {
      schemaVersion: 1,
      type: "untranslated-ui-report",
      appVersion: this.appVersion,
      generatedAt,
      filterStatus,
      totalCandidates: candidates.length,
      candidates,
    };
  }

  generateMarkdownReport({
    generatedAt = new Date().toISOString(),
    filterStatus = "untranslated",
  } = {}) {
    const candidates = this.getCandidates({ status: filterStatus });
    const lines = [
      `# Antigravity 未翻译英文 UI 采集报告 (${this.appVersion})`,
      "",
      `- **客户端版本**: ${this.appVersion}`,
      `- **生成时间**: ${generatedAt}`,
      `- **候选状态**: ${filterStatus}`,
      `- **未翻译候选总数**: ${candidates.length}`,
      "",
      "> [!NOTE]",
      "> 此报告由维护者采集工具自动生成，仅供审阅与词库补充参考。请人工核对语境后再添加至 `config/dom-translations.json`。",
      "",
      "| 序号 | 出现频次 | 原始英文 UI 文本 | 元素类型 / 属性 | 建议汉化 (待填) |",
      "| :--- | :---: | :--- | :--- | :--- |",
    ];

    if (candidates.length === 0) {
      lines.push("| - | 0 | *(未发现未覆盖的英文 UI)* | - | - |");
    } else {
      candidates.forEach((c, index) => {
        const types = [
          ...c.elementTypes,
          ...c.roles.map((r) => `role=${r}`),
          ...c.attributes.map((a) => `@${a}`),
        ].join(", ") || "text";
        const escapedText = c.text.replace(/\|/g, "\\|");
        lines.push(`| ${index + 1} | ${c.count} | \`${escapedText}\` | \`${types}\` | |`);
      });
    }

    lines.push("");
    return lines.join("\n");
  }
}
