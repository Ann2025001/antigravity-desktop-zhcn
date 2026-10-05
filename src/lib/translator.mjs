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

function normalizePatternTarget(target) {
  return typeof target === "string" ? target.replace(/\\(\d)/g, "$$$1") : target;
}

function compilePatternTranslations(dictionary) {
  return (dictionary.patterns ?? []).map(({ source, target, flags = "u" }) => ({
    regex: new RegExp(source, flags),
    target: normalizePatternTarget(target),
  }));
}

export function translateDictionaryValue(value, dictionary) {
  if (typeof value !== "string" || value.length === 0) return null;
  const leading = value.match(/^\s*/u)?.[0] ?? "";
  const trailing = value.match(/\s*$/u)?.[0] ?? "";
  const coreEnd = value.length - trailing.length;
  const core = value.slice(leading.length, coreEnd);
  let exact = dictionary?.exact?.[core];
  if (exact !== undefined) return leading + exact + trailing;

  const normalizedCore = core.replace(/\s+/g, " ");
  if (normalizedCore !== core) {
    exact = dictionary?.exact?.[normalizedCore];
    if (exact !== undefined) return leading + exact + trailing;
  }

  for (const { regex, target } of compilePatternTranslations(dictionary)) {
    regex.lastIndex = 0;
    if (regex.test(core)) {
      regex.lastIndex = 0;
      return leading + core.replace(regex, target) + trailing;
    }
    if (normalizedCore !== core && regex.test(normalizedCore)) {
      regex.lastIndex = 0;
      return leading + normalizedCore.replace(regex, target) + trailing;
    }
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
  const normalizedPatterns = (dictionary.patterns ?? []).map((p) => ({
    ...p,
    target: normalizePatternTarget(p.target),
  }));
  const serializedPatterns = JSON.stringify(normalizedPatterns);
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
    ".monaco-editor",
    "[data-testid='model-selector-item']",
    "[data-testid='model-selector-effort-group']",
    "[data-testid='model-selector-effort-option']"
  ].join(",");
  const blockedAttributeSelector = [
    "script",
    "style",
    "code",
    "pre",
    ".monaco-editor",
    "[data-testid='model-selector-item']"
  ].join(",");
  const translatedAttributes = ["aria-label", "title", "placeholder", "data-tooltip", "data-title"];
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

  const collectorRecords = [];
  const collector = {
    enabled: Boolean(globalThis.__AGY_ZHCN_COLLECTOR__?.enabled),
    dump() {
      return [...collectorRecords];
    },
    clear() {
      collectorRecords.length = 0;
    },
    record(entry) {
      if (!this.enabled || !entry || typeof entry.text !== "string") return;
      collectorRecords.push(entry);
    }
  };

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
    let exact = exactTranslations.get(core);
    if (exact !== undefined) return leading + exact + trailing;

    const normalizedCore = core.replace(/\\s+/g, " ");
    if (normalizedCore !== core) {
      exact = exactTranslations.get(normalizedCore);
      if (exact !== undefined) return leading + exact + trailing;
    }

    for (const { regex, target } of patternTranslations) {
      regex.lastIndex = 0;
      if (regex.test(core)) {
        regex.lastIndex = 0;
        return leading + core.replace(regex, target) + trailing;
      }
      if (normalizedCore !== core && regex.test(normalizedCore)) {
        regex.lastIndex = 0;
        return leading + normalizedCore.replace(regex, target) + trailing;
      }
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
    } else if (collector.enabled && translated === null && node.nodeValue?.trim()) {
      collector.record({
        text: node.nodeValue.trim(),
        tagName: parent.tagName,
        role: parent.getAttribute("role") || "",
        attributeName: ""
      });
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
      } else if (collector.enabled && translated === null && current?.trim()) {
        collector.record({
          text: current.trim(),
          tagName: element.tagName,
          role: element.getAttribute("role") || "",
          attributeName: attribute
        });
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
    globalThis.__AGY_ZHCN_COLLECTOR__ = collector;
    globalThis.__AGY_ZHCN__ = Object.freeze({
      version: "0.1.1",
      strategy: "dom-overlay",
      stats,
      collector
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
  let sourceText = sourceBuffer.toString("utf8");

  // 原生深度汉化注入：工作耗时、时间单位、动作前缀等
  sourceText = sourceText.replaceAll(
    '${l.killed?"Stopped after":"Worked for"}',
    '${l.killed?"耗时后停止":"工作耗时"}'
  );
  sourceText = sourceText.replaceAll(
    'l.terminatedEarly?"Stopped after":"Worked for"',
    'l.terminatedEarly?"耗时后停止":"工作耗时"'
  );
  sourceText = sourceText.replace(
    'if(a<60)return`${a}s`;var b=Math.floor(a/60);if(b<60)return`${b}m`;',
    'if(a<60)return`${a} 秒`;var b=Math.floor(a/60);if(b<60)return`${b} 分钟`;'
  );
  sourceText = sourceText.replaceAll('`Ran command: \\`${a}\\``', '`已运行命令：\\`${a}\\``');
  sourceText = sourceText.replaceAll('"Ran command"', '"已运行命令"');
  sourceText = sourceText.replaceAll('"Ran command:"', '"已运行命令："');
  sourceText = sourceText.replaceAll(
    '(a=b?.titlePrefix)?`${a} ${c}`:c',
    '(a=(b?.titlePrefix==="Ran"?"已运行":b?.titlePrefix==="Running"?"正在运行":b?.titlePrefix==="Edited"?"已编辑":b?.titlePrefix==="Created"?"已创建":b?.titlePrefix==="Viewed"?"已查看":b?.titlePrefix==="Killed task"?"已终止任务":b?.titlePrefix==="Killing task"?"正在终止任务":b?.titlePrefix))?`${a} ${c}`:c'
  );
  sourceText = sourceText.replaceAll(
    'a.push(`${c?"Exploring":"Explored"} ${f}`)',
    'a.push(`${c?"正在探索":"已探索"} ${f.replace(/(\\d+)\\s*tasks?/g, "$1 个任务").replace(/(\\d+)\\s*files?/g, "$1 个文件").replace(/(\\d+)\\s*commands?/g, "$1 条命令")}`)'
  );
  sourceText = sourceText.replaceAll('"Refreshing..."', '"正在刷新..."');
  sourceText = sourceText.replaceAll('"Good Response"', '"回答很好"');
  sourceText = sourceText.replaceAll('"Bad Response"', '"回答不佳"');

  // 右侧栏栏目与空状态原生汉化
  sourceText = sourceText.replaceAll('{id:"artifacts",title:"Artifacts"', '{id:"artifacts",title:"工件"');
  sourceText = sourceText.replaceAll('{id:"uploads",title:"Uploads"', '{id:"uploads",title:"已上传附件"');
  sourceText = sourceText.replaceAll('{id:"goals",title:"Goals"', '{id:"goals",title:"目标"');
  sourceText = sourceText.replaceAll('emptyText:e="No artifacts generated"', 'emptyText:e="暂无已生成的工件"');
  sourceText = sourceText.replaceAll('emptyText:"No uploads"', 'emptyText:"暂无上传附件"');
  sourceText = sourceText.replaceAll('h.length===0?z.createElement(uW,null,"No active terminals")', 'h.length===0?z.createElement(uW,null,"暂无活动终端")');
  sourceText = sourceText.replaceAll('"No active terminals. Click + to create one."', '"暂无活动终端，点击 + 创建。"');
  sourceText = sourceText.replaceAll('content:"Cancel Task"', 'content:"取消任务"');
  sourceText = sourceText.replaceAll('content:"Open Terminal"', 'content:"打开终端"');
  sourceText = sourceText.replaceAll('"aria-label":"Open Terminal"', '"aria-label":"打开终端"');
  sourceText = sourceText.replaceAll('"No subagents"', '"暂无子智能体"');
  // 撤销与运行状态原生汉化
  sourceText = sourceText.replaceAll('"This undo action will not make any code changes."', '"此撤销操作不会产生任何代码变更。"');
  sourceText = sourceText.replaceAll('"Confirming this undo action will make the following changes:"', '"确认此撤销操作将应用以下更改："');
  sourceText = sourceText.replaceAll('"Undo to this point"', '"撤销到此处"');
  sourceText = sourceText.replaceAll('"User cancelled agent execution."', '"用户已取消智能体执行。"');
  sourceText = sourceText.replaceAll('"Agent execution failed."', '"智能体执行失败。"');
  sourceText = sourceText.replaceAll('"Cannot revert this message"', '"无法还原此消息"');
  sourceText = sourceText.replaceAll('"Cannot revert to a message that was cleared to save space"', '"无法还原到为节省空间已被清理的消息"');
  sourceText = sourceText.replaceAll('"Cannot revert messages while the agent is running"', '"智能体运行期间无法还原消息"');
  // 计划评审策略原生汉化
  sourceText = sourceText.replaceAll('label:"Plan Review Policy"', 'label:"计划评审策略"');
  // 工作流状态汇总原生汉化（根治 running X commands 与半中半英状态）
  sourceText = sourceText.replace(
    'zX={files:["file","files"],folders:["folder","folders"],edits:["file","files"],searches:["search","searches"],terminal:["command","commands"],tasks:["task","tasks"],web:["page","pages"],browser:["browser","browsers"],images:["image","images"],actions:["action","actions"],artifacts:["artifact","artifacts"]}',
    'zX={files:["个文件","个文件"],folders:["个文件夹","个文件夹"],edits:["处编辑","处编辑"],searches:["次搜索","次搜索"],terminal:["条命令","条命令"],tasks:["个任务","个任务"],web:["个网页","个网页"],browser:["个浏览器操作","个浏览器操作"],images:["张图片","张图片"],actions:["次操作","次操作"],artifacts:["个工件","个工件"]}'
  );
  sourceText = sourceText.replaceAll('f=c?g?"Running":"running":g?"Ran":"ran";', 'f=c?"正在运行":"已运行";');
  sourceText = sourceText.replaceAll('${c?"Editing":"Edited"} ${BX(a)||"files"}', '${c?"正在编辑":"已编辑"} ${BX(a)||"个文件"}');
  sourceText = sourceText.replaceAll('${e.length===1?"command":"commands"}', '"条命令"');
  sourceText = sourceText.replaceAll('b?`${c?"Exploring":"Explored"} ${b}`:c?"Working":"Done"', 'b?`${c?"正在探索":"已探索"} ${b}`:c?"工作中":"已完成"');

  sourceText = sourceText.replace(
    `z.createElement("span",null,"Type"," ",z.createElement("code",{className:"px-1.5 py-0.5 rounded bg-secondary text-foreground font-mono text-[11px] border border-border"},"/")," ","and select"," ",z.createElement("code",{className:"px-1.5 py-0.5 rounded bg-secondary text-foreground font-mono text-[11px] border border-border"},\n"plan")," ","to have the agent generate a plan.")`,
    `z.createElement("span",null,"输入 "," ",z.createElement("code",{className:"px-1.5 py-0.5 rounded bg-secondary text-foreground font-mono text-[11px] border border-border"},"/")," 并选择 ",z.createElement("code",{className:"px-1.5 py-0.5 rounded bg-secondary text-foreground font-mono text-[11px] border border-border"},\n"plan")," 可让智能体生成计划。")`
  );


  sourceText = sourceText.replaceAll('"aria-label":"Cancel Task"', '"aria-label":"取消任务"');

  // 查看全部与折叠展开原生汉化
  sourceText = sourceText.replaceAll('D?"See less":`See all (${c})`', 'D?"收起":`查看全部 (${c})`');
  sourceText = sourceText.replaceAll('da?`See all (${aa.items.length})`:"See less"', 'da?`查看全部 (${aa.items.length})`:"收起"');
  sourceText = sourceText.replaceAll('n?g?"Show less":"See less":g?`Show finished (${q})`:`See all (${e})`', 'n?g?"收起":"收起":g?`显示已完成 (${q})`:`查看全部 (${e})`');
  sourceText = sourceText.replaceAll('h?"See less":`See all (${c.length})`', 'h?"收起":`查看全部 (${c.length})`');
  sourceText = sourceText.replaceAll('"See all (",c.length,")"', '"查看全部 (",c.length,")"');
  sourceText = sourceText.replaceAll('k===10?`See all (${e.length})`:"See less"', 'k===10?`查看全部 (${e.length})`:"收起"');

  // 媒体名称与中文日期时间原生汉化
  sourceText = sourceText.replace(
    'c=a.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0})',
    'c=(a.getHours()<12?"上午 ":"下午 ")+(a.getHours()%12||12)+":"+String(a.getMinutes()).padStart(2,"0")'
  );
  sourceText = sourceText.replace(
    'if(a.toDateString()===b.toDateString())return`Today ${c}`;var e=new Date(b);e.setDate(e.getDate()-1);return a.toDateString()===e.toDateString()?`Yesterday ${c}`:a.getFullYear()===b.getFullYear()?`${a.toLocaleDateString("en-US",{month:"short",day:"numeric"})} ${c}`:`${a.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})} ${c}`',
    'if(a.toDateString()===b.toDateString())return`今天 ${c}`;var e=new Date(b);e.setDate(e.getDate()-1);return a.toDateString()===e.toDateString()?`昨天 ${c}`:a.getFullYear()===b.getFullYear()?`${a.getMonth()+1}月${a.getDate()}日 ${c}`:`${a.getFullYear()}年${a.getMonth()+1}月${a.getDate()}日 ${c}`'
  );
  sourceText = sourceText.replace(
    'if(WLa.test(a))return"Scratchpad";var [,b,c]=a.match(/^(.+?)_(\\d{13})$/)||[null,a,null];a=b.replace(/[_-]/g," ").replace(/([a-z])([A-Z])/g,"$1 $2").split(/\\s+/).filter(e=>e.length>0).map(e=>e.charAt(0).toUpperCase()+e.slice(1).toLowerCase()).join(" ");return c?`${a} (${$La(c)})`:a',
    'if(WLa.test(a))return"便签本";var [,b,c]=a.match(/^(.+?)_(\\d{13})$/)||[null,a,null];a=b.replace(/[_-]/g," ").replace(/([a-z])([A-Z])/g,"$1 $2").split(/\\s+/).filter(e=>e.length>0).map(e=>e.charAt(0).toUpperCase()+e.slice(1).toLowerCase()).join(" ");a=(a==="Media"?"媒体":a==="Screenshot"?"屏幕截图":a==="Scratchpad"?"便签本":a);return c?`${a} (${$La(c)})`:a'
  );

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
