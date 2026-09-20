import os
import sys
import json
import struct
import shutil
import hashlib
from datetime import datetime, timezone

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
DICT_PATH = os.path.join(PROJECT_ROOT, 'config', 'dom-translations.json')
APPDATA_DIR = os.environ.get('APPDATA', os.path.expanduser('~\\AppData\\Roaming'))
LOCALAPPDATA_DIR = os.environ.get('LOCALAPPDATA', os.path.expanduser('~\\AppData\\Local'))

ANTIGRAVITY_APP_DIR = os.path.join(LOCALAPPDATA_DIR, 'Programs', 'antigravity')
ASAR_PATH = os.path.join(ANTIGRAVITY_APP_DIR, 'resources', 'app.asar')
UI_BUNDLE_TARGET = os.path.join(APPDATA_DIR, 'Antigravity', 'agy_zhcn_ui_main.js')
LOG_PATH = os.path.join(LOCALAPPDATA_DIR, 'AntigravityZhcn', 'auto-patch.log')

def log(msg):
    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    line = f"[{ts}] {msg}"
    print(line)
    try:
        with open(LOG_PATH, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except Exception:
        pass

def align_to_four(n):
    return n + ((4 - (n % 4)) % 4)

def serialize_asar_header(header_dict):
    json_str = json.dumps(header_dict, separators=(',', ':'))
    json_bytes = json_str.encode('utf-8')
    pad_len = (4 - (len(json_bytes) % 4)) % 4
    padded_json = json_bytes + (b'\0' * pad_len)
    payload_size = 4 + len(padded_json)
    header_pickle = struct.pack('<II', payload_size, len(json_bytes)) + padded_json
    size_pickle = struct.pack('<II', 4, len(header_pickle))
    return size_pickle + header_pickle

def patch_custom_scheme_code(source_code):
    normalized = source_code.replace('\r\n', '\n')
    if 'agy-zhcn://bundle/main.js' in normalized:
        return None  # already patched
    
    scheme_anchor = "        },\n    ]);\n}"
    scheme_replacement = """        },
        {
            scheme: 'agy-zhcn',
            privileges: {
                standard: true,
                secure: true,
                supportFetchAPI: true,
                corsEnabled: true,
                codeCache: true,
            },
        },
    ]);
}"""

    handler_anchor = "    });\n}\n"
    handler_replacement = """    });

    // Antigravity Desktop ZHCN: serve a verified local UI bundle.
    electron_1.session.defaultSession.clearCache().catch((err) => {
        console.error("Failed to clear cache before loading ZHCN UI:", err);
    });
    electron_1.protocol.handle('agy-zhcn', async () => {
        const path = require("path");
        const fsPromises = require("fs/promises");
        const bundlePath = path.join(electron_1.app.getPath('userData'), 'agy_zhcn_ui_main.js');
        const content = await fsPromises.readFile(bundlePath);
        return new Response(content, {
            status: 200,
            headers: {
                'Content-Type': 'application/javascript; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-store'
            }
        });
    });
    electron_1.session.defaultSession.webRequest.onBeforeRequest(
        { urls: ['https://127.0.0.1:*/main.js'] },
        (_details, callback) => {
            callback({ redirectURL: 'agy-zhcn://bundle/main.js' });
        }
    );
}
"""
    if scheme_anchor not in normalized or handler_anchor not in normalized:
        raise ValueError("Cannot locate anchor points in customScheme.js")
    
    res = normalized.replace(scheme_anchor, scheme_replacement, 1)
    res = res.replace(handler_anchor, handler_replacement, 1)
    return res

def patch_asar(source_asar, target_asar):
    with open(source_asar, 'rb') as f:
        fixed_header = f.read(16)
        header_pickle_size = struct.unpack('<I', fixed_header[4:8])[0]
        json_size = struct.unpack('<I', fixed_header[12:16])[0]
        header_json = f.read(json_size).decode('utf-8')
        header = json.loads(header_json)
        data_offset = 8 + header_pickle_size

    custom_scheme_entry = header['files']['dist']['files']['customScheme.js']
    cs_offset = int(custom_scheme_entry['offset'])
    cs_size = int(custom_scheme_entry['size'])

    with open(source_asar, 'rb') as f:
        f.seek(data_offset + cs_offset)
        raw_cs_code = f.read(cs_size).decode('utf-8')

    patched_cs_code = patch_custom_scheme_code(raw_cs_code)
    if patched_cs_code is None:
        log("customScheme.js is already patched.")
        return False

    patched_cs_bytes = patched_cs_code.encode('utf-8')
    size_diff = len(patched_cs_bytes) - cs_size

    # 重新计算所有文件的 offset
    def walk_adjust_offsets(node):
        for name, item in node.get('files', {}).items():
            if 'files' in item:
                walk_adjust_offsets(item)
            elif 'offset' in item:
                cur_off = int(item['offset'])
                if cur_off > cs_offset:
                    item['offset'] = str(cur_off + size_diff)
                elif cur_off == cs_offset:
                    item['size'] = len(patched_cs_bytes)

    walk_adjust_offsets(header)

    serialized_header = serialize_asar_header(header)

    # 写入新 asar
    temp_target = target_asar + '.tmp'
    with open(temp_target, 'wb') as out_f, open(source_asar, 'rb') as in_f:
        out_f.write(serialized_header)
        
        # 写入 customScheme 之前的数据
        in_f.seek(data_offset)
        if cs_offset > 0:
            out_f.write(in_f.read(cs_offset))
        
        # 写入替换的 customScheme
        out_f.write(patched_cs_bytes)
        
        # 写入 customScheme 之后的数据
        in_f.seek(data_offset + cs_offset + cs_size)
        shutil.copyfileobj(in_f, out_f)

    if os.path.exists(target_asar):
        os.replace(temp_target, target_asar)
    else:
        os.rename(temp_target, target_asar)

    log("Successfully patched app.asar!")
    return True

def generate_ui_overlay(dict_data):
    serialized_exact = json.dumps(dict_data['exact'], ensure_ascii=False)
    serialized_patterns = json.dumps(dict_data.get('patterns', []), ensure_ascii=False)
    return f"""
;(() => {{
  "use strict";
  const exactTranslations = new Map(Object.entries({serialized_exact}));
  const patternTranslations = {serialized_patterns}.map(({{ source, target, flags }}) => ({{
    regex: new RegExp(source, flags),
    target
  }}));
  const blockedSelector = [
    "script", "style", "code", "pre", "textarea", "input",
    "[contenteditable='true']", "[data-lexical-editor='true']", ".monaco-editor"
  ].join(",");
  const blockedAttributeSelector = ["script", "style", "code", "pre", ".monaco-editor"].join(",");
  const translatedAttributes = ["aria-label", "title", "placeholder"];
  const pendingRoots = new Set();
  let scheduled = false;
  const stats = {{
    dictionarySize: exactTranslations.size,
    patternCount: patternTranslations.length,
    translatedTextNodes: 0,
    translatedAttributes: 0
  }};
  const dynamicSelector = "p,li,blockquote,h1,h2,h3,h4,h5,h6,td,th,span,div";
  const dynamicBlockedSelector = ["button", "a", "nav", "[role='button']", "[contenteditable='true']", "code", "pre", ".monaco-editor"].join(",");

  function isBlocked(element) {{ return Boolean(element?.closest?.(blockedSelector)); }}
  function isAttributeBlocked(element) {{ return Boolean(element?.closest?.(blockedAttributeSelector)); }}

  function translateValue(value) {{
    if (typeof value !== "string" || value.length === 0) return null;
    const leading = value.match(/^\\s*/u)?.[0] ?? "";
    const trailing = value.match(/\\s*$/u)?.[0] ?? "";
    const coreEnd = value.length - trailing.length;
    const core = value.slice(leading.length, coreEnd);
    const exact = exactTranslations.get(core);
    if (exact !== undefined) return leading + exact + trailing;
    for (const {{ regex, target }} of patternTranslations) {{
      regex.lastIndex = 0;
      if (!regex.test(core)) continue;
      regex.lastIndex = 0;
      return leading + core.replace(regex, target) + trailing;
    }}
    return null;
  }}

  function translateTextNode(node) {{
    const parent = node.parentElement;
    if (!parent || isBlocked(parent)) return;
    const translated = translateValue(node.nodeValue);
    if (translated !== null && translated !== node.nodeValue) {{
      node.nodeValue = translated;
      stats.translatedTextNodes += 1;
    }}
  }}

  function translateElementAttributes(element) {{
    if (isAttributeBlocked(element)) return;
    for (const attribute of translatedAttributes) {{
      if (!element.hasAttribute(attribute)) continue;
      const current = element.getAttribute(attribute);
      const translated = translateValue(current);
      if (translated !== null && translated !== current) {{
        element.setAttribute(attribute, translated);
        stats.translatedAttributes += 1;
      }}
    }}
  }}

  async function translateDynamicElement(element) {{
    const thoughtContext = element?.closest?.("[data-testid*='thinking'], [data-testid*='thought']");
    if (
      (!element?.matches?.(dynamicSelector) && !thoughtContext) ||
      element.dataset.agyZhcnDynamic ||
      element.closest(dynamicBlockedSelector) ||
      element.parentElement?.querySelector("[contenteditable='true'], [data-lexical-editor='true']") ||
      element.querySelector("p,li,blockquote,h1,h2,h3,h4,h5,h6")
    ) return;
    const source = element.textContent?.trim();
    if (
      !source || source.length < 18 || source.length > 8000 ||
      !/[A-Za-z]{{3,}}/.test(source) ||
      (source.match(/[\\u4e00-\\u9fff]/g) || []).length > 8
    ) return;
    element.dataset.agyZhcnDynamic = "pending";
    try {{
      const response = await fetch("http://127.0.0.1:45831/translate", {{
        method: "POST",
        headers: {{ "Content-Type": "application/json" }},
        body: JSON.stringify({{ text: source }})
      }});
      const result = response.ok ? await response.json() : null;
      if (typeof result?.translatedText === "string" && result.translatedText.trim()) {{
        element.textContent = result.translatedText;
        stats.translatedTextNodes += 1;
      }}
    }} catch (_) {{}} finally {{
      element.dataset.agyZhcnDynamic = "done";
    }}
  }}

  function translateTree(root) {{
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {{
      translateTextNode(root);
      return;
    }}
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE) {{
      translateElementAttributes(root);
      translateDynamicElement(root);
    }}
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let current;
    while ((current = walker.nextNode())) {{
      if (current.nodeType === Node.TEXT_NODE) {{
        translateTextNode(current);
      }} else {{
        translateElementAttributes(current);
        translateDynamicElement(current);
      }}
    }}
  }}

  function flush() {{
    scheduled = false;
    const roots = [...pendingRoots];
    pendingRoots.clear();
    for (const root of roots) translateTree(root);
  }}

  function enqueue(root) {{
    pendingRoots.add(root);
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(flush);
  }}

  function start() {{
    document.documentElement.lang = "zh-CN";
    translateTree(document.documentElement);
    const observer = new MutationObserver((mutations) => {{
      for (const mutation of mutations) {{
        if (mutation.type === "characterData" || mutation.type === "attributes") {{
          enqueue(mutation.target);
        }} else {{
          for (const node of mutation.addedNodes) enqueue(node);
        }}
      }}
    }});
    observer.observe(document.documentElement, {{
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: translatedAttributes
    }});
    globalThis.__AGY_ZHCN__ = Object.freeze({{
      version: "0.2.0",
      strategy: "dom-overlay-auto",
      stats
    }});
  }}

  if (document.readyState === "loading") {{
    document.addEventListener("DOMContentLoaded", start, {{ once: true }});
  }} else {{
    start();
  }}
}})();
"""

def update_ui_bundle():
    with open(DICT_PATH, 'r', encoding='utf-8') as f:
        dict_data = json.load(f)
    
    RAW_BUNDLE_SIZE = 9438455
    if os.path.exists(UI_BUNDLE_TARGET):
        with open(UI_BUNDLE_TARGET, 'r', encoding='utf-8') as f:
            current_content = f.read()
        raw_ui_text = current_content[:RAW_BUNDLE_SIZE]
    else:
        # 尝试从 .runtime 获取
        cached = os.path.join(PROJECT_ROOT, '.runtime', 'build', '2.15.0', 'agy_zhcn_ui_main.js')
        with open(cached, 'r', encoding='utf-8') as f:
            raw_ui_text = f.read()[:RAW_BUNDLE_SIZE]
    
    overlay = generate_ui_overlay(dict_data)
    full_bundle = f"{raw_ui_text}\n{overlay}".encode('utf-8')
    
    os.makedirs(os.path.dirname(UI_BUNDLE_TARGET), exist_ok=True)
    with open(UI_BUNDLE_TARGET, 'wb') as f:
        f.write(full_bundle)
    log("Successfully refreshed localized UI bundle.")

def check_and_auto_patch():
    if not os.path.exists(ASAR_PATH):
        log(f"Antigravity asar not found at: {ASAR_PATH}")
        return False
    
    # 检查 ASAR 是否已被补丁
    with open(ASAR_PATH, 'rb') as f:
        fixed_header = f.read(16)
        header_pickle_size = struct.unpack('<I', fixed_header[4:8])[0]
        json_size = struct.unpack('<I', fixed_header[12:16])[0]
        header_json = f.read(json_size).decode('utf-8')
        header = json.loads(header_json)
        data_offset = 8 + header_pickle_size

    custom_scheme_entry = header['files']['dist']['files']['customScheme.js']
    cs_offset = int(custom_scheme_entry['offset'])
    cs_size = int(custom_scheme_entry['size'])

    with open(ASAR_PATH, 'rb') as f:
        f.seek(data_offset + cs_offset)
        raw_cs_code = f.read(cs_size).decode('utf-8')

    is_patched = 'agy-zhcn://bundle/main.js' in raw_cs_code
    if not is_patched:
        log("Antigravity update detected! Missing zhcn patch in app.asar. Patching now...")
        # 备份
        backup_path = ASAR_PATH + '.original'
        if not os.path.exists(backup_path):
            shutil.copy2(ASAR_PATH, backup_path)
        
        patch_asar(ASAR_PATH, ASAR_PATH)
        update_ui_bundle()
        log("Auto-patch completed successfully for the new version!")
        return True
    else:
        # 已有补丁，仅确保 UI bundle 是最新字典
        update_ui_bundle()
        log("Antigravity is up-to-date and correctly patched.")
        return False

if __name__ == '__main__':
    log("Running Antigravity Auto-Patcher...")
    check_and_auto_patch()
