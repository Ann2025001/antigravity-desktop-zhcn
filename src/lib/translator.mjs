import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "./paths.mjs";
import { sha256Buffer } from "./hash.mjs";

export async function loadDomTranslations() {
  const filePath = path.join(projectRoot, "config", "dom-translations.json");
  const data = JSON.parse(await readFile(filePath, "utf8"));
  if (
    data.schemaVersion !== 2 ||
    !data.exact ||
    typeof data.exact !== "object" ||
    !Array.isArray(data.patterns)
  ) {
    throw new Error("DOM 翻译词典格式无效。");
  }
  for (const pattern of data.patterns) {
    if (
      !pattern ||
      typeof pattern.source !== "string" ||
      typeof pattern.target !== "string" ||
      typeof pattern.flags !== "string"
    ) {
      throw new Error("DOM 动态翻译规则格式无效。");
    }
    try {
      new RegExp(pattern.source, pattern.flags);
    } catch {
      throw new Error(`DOM 动态翻译规则无效：${pattern.source}`);
    }
  }
  return data;
}

function compilePatternTranslations(dictionary) {
  return (dictionary.patterns ?? []).map(({ source, target, flags = "u" }) => ({
    regex: new RegExp(source, flags),
    target,
  }));
}

export function translateDictionaryValue(value, dictionary) {
  if (typeof value !== "string" || value.length === 0) return null;
  const leading = value.match(/^\s*/u)?.[0] ?? "";
  const trailing = value.match(/\s*$/u)?.[0] ?? "";
  const coreEnd = value.length - trailing.length;
  const core = value.slice(leading.length, coreEnd);
  const exact = dictionary.exact[core];
  if (exact !== undefined) return leading + exact + trailing;

  for (const { regex, target } of compilePatternTranslations(dictionary)) {
    regex.lastIndex = 0;
    if (!regex.test(core)) continue;
    regex.lastIndex = 0;
    return leading + core.replace(regex, target) + trailing;
  }
  return null;
}

export function countBundleDictionaryHits(bundleText, dictionary) {
  let hits = 0;
  for (const source of Object.keys(dictionary.exact)) {
    if (bundleText.includes(source)) {
      hits += 1;
    }
  }
  return {
    hits,
    total: Object.keys(dictionary.exact).length,
  };
}

export function createRuntimeOverlay(dictionary) {
  const serialized = JSON.stringify(dictionary.exact);
  const serializedPatterns = JSON.stringify(dictionary.patterns ?? []);
  return `
;(() => {
  "use strict";
  const exactTranslations = new Map(Object.entries(${serialized}));
  const patternTranslations = ${serializedPatterns}.map(({ source, target, flags }) => ({
    regex: new RegExp(source, flags),
    target
  }));
  const blockedSelector = [
    "script",
    "style",
    "code",
    "pre",
    "textarea",
    "input",
    "[contenteditable='true']",
    "[data-lexical-editor='true']",
    ".monaco-editor"
  ].join(",");
  const blockedAttributeSelector = [
    "script",
    "style",
    "code",
    "pre",
    ".monaco-editor"
  ].join(",");
  const translatedAttributes = ["aria-label", "title", "placeholder"];
  const pendingRoots = new Set();
  let scheduled = false;
  const stats = {
    dictionarySize: exactTranslations.size,
    patternCount: patternTranslations.length,
    translatedTextNodes: 0,
    translatedAttributes: 0
  };
  const dynamicSelector = "p,li,blockquote,h1,h2,h3,h4,h5,h6,td,th";
  const dynamicBlockedSelector = [
    "button",
    "a",
    "nav",
    "[role='button']",
    "[contenteditable='true']",
    "code",
    "pre",
    ".monaco-editor"
  ].join(",");

  function isBlocked(element) {
    return Boolean(element?.closest?.(blockedSelector));
  }

  function isAttributeBlocked(element) {
    return Boolean(element?.closest?.(blockedAttributeSelector));
  }

  function translateValue(value) {
    if (typeof value !== "string" || value.length === 0) return null;
    const leading = value.match(/^\\s*/u)?.[0] ?? "";
    const trailing = value.match(/\\s*$/u)?.[0] ?? "";
    const coreEnd = value.length - trailing.length;
    const core = value.slice(leading.length, coreEnd);
    const exact = exactTranslations.get(core);
    if (exact !== undefined) return leading + exact + trailing;
    for (const { regex, target } of patternTranslations) {
      regex.lastIndex = 0;
      if (!regex.test(core)) continue;
      regex.lastIndex = 0;
      return leading + core.replace(regex, target) + trailing;
    }
    return null;
  }

  function translateTextNode(node) {
    const parent = node.parentElement;
    if (!parent || isBlocked(parent)) return;
    const translated = translateValue(node.nodeValue);
    if (translated !== null && translated !== node.nodeValue) {
      node.nodeValue = translated;
      stats.translatedTextNodes += 1;
    }
  }

  function translateElementAttributes(element) {
    if (isAttributeBlocked(element)) return;
    for (const attribute of translatedAttributes) {
      if (!element.hasAttribute(attribute)) continue;
      const current = element.getAttribute(attribute);
      const translated = translateValue(current);
      if (translated !== null && translated !== current) {
        element.setAttribute(attribute, translated);
        stats.translatedAttributes += 1;
      }
    }
  }

  async function translateDynamicElement(element) {
    const thoughtContext = element?.closest?.("[data-testid*='thinking'], [data-testid*='thought']");
    if (
      (!element?.matches?.(dynamicSelector) && !thoughtContext) ||
      element.dataset.agyZhcnDynamic ||
      element.closest(dynamicBlockedSelector) ||
      element.parentElement?.querySelector("[contenteditable='true'], [data-lexical-editor='true']") ||
      element.querySelector(dynamicSelector)
    ) return;
    const source = element.textContent?.trim();
    if (
      !source || source.length < 18 || source.length > 8000 ||
      !/[A-Za-z]{3,}/.test(source) ||
      (source.match(/[\u4e00-\u9fff]/g) || []).length > 8
    ) return;
    element.dataset.agyZhcnDynamic = "pending";
    try {
      const response = await fetch("http://127.0.0.1:45831/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: source })
      });
      const result = response.ok ? await response.json() : null;
      if (typeof result?.translatedText === "string" && result.translatedText.trim()) {
        element.textContent = result.translatedText;
        stats.translatedTextNodes += 1;
      }
    } catch (_) {
      // Local translator is optional; leave the original UI visible if unavailable.
    } finally {
      element.dataset.agyZhcnDynamic = "done";
    }
  }

  function translateTree(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) {
      return;
    }
    if (root.nodeType === Node.ELEMENT_NODE) {
      translateElementAttributes(root);
      translateDynamicElement(root);
    }
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT
    );
    let current;
    while ((current = walker.nextNode())) {
      if (current.nodeType === Node.TEXT_NODE) {
        translateTextNode(current);
      } else {
        translateElementAttributes(current);
        translateDynamicElement(current);
      }
    }
  }

  function flush() {
    scheduled = false;
    const roots = [...pendingRoots];
    pendingRoots.clear();
    for (const root of roots) translateTree(root);
  }

  function enqueue(root) {
    pendingRoots.add(root);
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(flush);
  }

  function start() {
    document.documentElement.lang = "zh-CN";
    translateTree(document.documentElement);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          enqueue(mutation.target);
        } else if (mutation.type === "attributes") {
          enqueue(mutation.target);
        } else {
          for (const node of mutation.addedNodes) enqueue(node);
        }
      }
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: translatedAttributes
    });
    globalThis.__AGY_ZHCN__ = Object.freeze({
      version: "0.1.1",
      strategy: "dom-overlay",
      stats
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
`;
}

export function createLocalizedBundle(sourceBuffer, dictionary) {
  const sourceText = sourceBuffer.toString("utf8");
  const overlay = createRuntimeOverlay(dictionary);
  const localized = Buffer.from(`${sourceText}\n${overlay}`, "utf8");
  return {
    buffer: localized,
    sha256: sha256Buffer(localized),
    coverage: countBundleDictionaryHits(sourceText, dictionary),
  };
}

export async function writeLocalizedBundle(outputPath, localizedBuffer) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, localizedBuffer, { flag: "w" });
}
