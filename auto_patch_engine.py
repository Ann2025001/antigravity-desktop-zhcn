import os
import sys
import json
import struct
import shutil
import hashlib
import argparse
from datetime import datetime

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
DICT_PATH = os.path.join(PROJECT_ROOT, 'config', 'dom-translations.json')
APPDATA_DIR = os.environ.get('APPDATA', os.path.expanduser('~\\AppData\\Roaming'))
LOCALAPPDATA_DIR = os.environ.get('LOCALAPPDATA', os.path.expanduser('~\\AppData\\Local'))

LOG_PATH = os.path.join(LOCALAPPDATA_DIR, 'AntigravityZhcn', 'patcher.log')

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

def find_antigravity_dir(custom_path=None):
    if custom_path and os.path.exists(custom_path):
        return custom_path
    
    env_path = os.environ.get('AGY_INSTALL_PATH')
    if env_path and os.path.exists(env_path):
        return env_path

    candidates = [
        os.path.join(LOCALAPPDATA_DIR, 'Programs', 'antigravity'),
        r'D:\antigravity\Programs\antigravity',
        r'C:\Program Files\antigravity',
        r'F:\antigravity'
    ]
    for c in candidates:
        if os.path.exists(os.path.join(c, 'resources', 'app.asar')):
            return c
    return candidates[0]

def serialize_asar_header(header_dict):
    json_str = json.dumps(header_dict, separators=(',', ':'))
    json_bytes = json_str.encode('utf-8')
    pad_len = (4 - (len(json_bytes) % 4)) % 4
    padded_json = json_bytes + (b'\0' * pad_len)
    payload_size = 4 + len(padded_json)
    header_pickle = struct.pack('<II', payload_size, len(json_bytes)) + padded_json
    size_pickle = struct.pack('<II', 4, len(header_pickle))
    return size_pickle + header_pickle

SCHEME_BLOCK = """        },
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

HANDLER_BLOCK = """    });

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

def patch_custom_scheme_code(source_code):
    normalized = source_code.replace('\r\n', '\n')
    if 'agy-zhcn://bundle/main.js' in normalized:
        return None  # already patched
    
    scheme_anchor = "        },\n    ]);\n}"
    handler_anchor = "    });\n}\n"
    
    if scheme_anchor not in normalized or handler_anchor not in normalized:
        raise ValueError("Cannot locate anchor points in customScheme.js")
    
    res = normalized.replace(scheme_anchor, SCHEME_BLOCK, 1)
    res = res.replace(handler_anchor, HANDLER_BLOCK, 1)
    return res

def unpatch_custom_scheme_code(source_code):
    normalized = source_code.replace('\r\n', '\n')
    if 'agy-zhcn://bundle/main.js' not in normalized:
        return None  # not patched
    
    orig_scheme = "        },\n    ]);\n}"
    orig_handler = "    });\n}\n"
    
    res = normalized.replace(SCHEME_BLOCK, orig_scheme, 1)
    res = res.replace(HANDLER_BLOCK, orig_handler, 1)
    return res

def patch_asar(source_asar, target_asar, revert=False):
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

    if revert:
        new_cs_code = unpatch_custom_scheme_code(raw_cs_code)
        if new_cs_code is None:
            log("customScheme.js is already official English.")
            return False
    else:
        new_cs_code = patch_custom_scheme_code(raw_cs_code)
        if new_cs_code is None:
            log("customScheme.js is already patched.")
            return False

    new_cs_bytes = new_cs_code.encode('utf-8')
    size_diff = len(new_cs_bytes) - cs_size

    def walk_adjust_offsets(node):
        for name, item in node.get('files', {}).items():
            if 'files' in item:
                walk_adjust_offsets(item)
            elif 'offset' in item:
                cur_off = int(item['offset'])
                if cur_off > cs_offset:
                    item['offset'] = str(cur_off + size_diff)
                elif cur_off == cs_offset:
                    item['size'] = len(new_cs_bytes)

    walk_adjust_offsets(header)
    serialized_header = serialize_asar_header(header)

    temp_target = target_asar + '.tmp'
    with open(temp_target, 'wb') as out_f, open(source_asar, 'rb') as in_f:
        out_f.write(serialized_header)
        in_f.seek(data_offset)
        if cs_offset > 0:
            out_f.write(in_f.read(cs_offset))
        out_f.write(new_cs_bytes)
        in_f.seek(data_offset + cs_offset + cs_size)
        shutil.copyfileobj(in_f, out_f)

    if os.path.exists(target_asar):
        os.replace(temp_target, target_asar)
    else:
        os.rename(temp_target, target_asar)

    log("Successfully modified app.asar!")
    return True

def generate_ui_overlay(dict_data):
    serialized_exact = json.dumps(dict_data.get('exact', {}), ensure_ascii=False)
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

  function translateTree(root) {{
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {{
      translateTextNode(root);
      return;
    }}
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE) {{
      translateElementAttributes(root);
    }}
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let current;
    while ((current = walker.nextNode())) {{
      if (current.nodeType === Node.TEXT_NODE) {{
        translateTextNode(current);
      }} else {{
        translateElementAttributes(current);
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
      version: "2.15.0-zhcn-plus",
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

def update_ui_bundle(bundle_target=None):
    target = bundle_target or os.path.join(APPDATA_DIR, 'Antigravity', 'agy_zhcn_ui_main.js')
    with open(DICT_PATH, 'r', encoding='utf-8') as f:
        dict_data = json.load(f)
    
    RAW_BUNDLE_SIZE = 9438455
    cached = os.path.join(PROJECT_ROOT, '.runtime', 'build', '2.15.0', 'agy_zhcn_ui_main.js')
    if os.path.exists(target):
        with open(target, 'r', encoding='utf-8') as f:
            raw_ui_text = f.read()[:RAW_BUNDLE_SIZE]
    elif os.path.exists(cached):
        with open(cached, 'r', encoding='utf-8') as f:
            raw_ui_text = f.read()[:RAW_BUNDLE_SIZE]
    else:
        raise FileNotFoundError("Base UI bundle not found in cache or target.")
    
    overlay = generate_ui_overlay(dict_data)
    full_bundle = f"{raw_ui_text}\n{overlay}".encode('utf-8')
    
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, 'wb') as f:
        f.write(full_bundle)
    log(f"Successfully generated and deployed UI bundle to {target}")

def do_install(app_dir=None, bundle_target=None):
    target_app_dir = find_antigravity_dir(app_dir)
    asar_path = os.path.join(target_app_dir, 'resources', 'app.asar')
    if not os.path.exists(asar_path):
        log(f"[错误] 未找到 Antigravity 核心文件：{asar_path}")
        return False

    backup_path = asar_path + '.original'
    if not os.path.exists(backup_path):
        shutil.copy2(asar_path, backup_path)
        log(f"已创建官方原始 ASAR 备份：{backup_path}")

    patch_asar(asar_path, asar_path, revert=False)
    update_ui_bundle(bundle_target)
    print("\n========================================================")
    print("   [成功] Antigravity 2.15.0+ 深度汉化已成功安装并生效！")
    print(f"   词库规模：{len(json.load(open(DICT_PATH, encoding='utf-8'))['exact'])} 精确词条")
    print("========================================================\n")
    return True

def do_restore(app_dir=None, bundle_target=None):
    target_app_dir = find_antigravity_dir(app_dir)
    asar_path = os.path.join(target_app_dir, 'resources', 'app.asar')
    backup_path = asar_path + '.original'
    bundle_path = bundle_target or os.path.join(APPDATA_DIR, 'Antigravity', 'agy_zhcn_ui_main.js')

    if os.path.exists(backup_path):
        shutil.copy2(backup_path, asar_path)
        log("已成功从备份恢复官方原始英文 app.asar。")
    elif os.path.exists(asar_path):
        patch_asar(asar_path, asar_path, revert=True)
        log("已成功逆向解除 app.asar 协议注入，恢复为官方原版。")

    if os.path.exists(bundle_path):
        os.remove(bundle_path)
        log("已移除本地汉化 UI 注入包。")

    print("\n========================================================")
    print("   [成功] Antigravity 已成功恢复为官方原版英文状态！")
    print("========================================================\n")
    return True

def do_check(app_dir=None):
    target_app_dir = find_antigravity_dir(app_dir)
    asar_path = os.path.join(target_app_dir, 'resources', 'app.asar')
    backup_path = asar_path + '.original'
    bundle_path = os.path.join(APPDATA_DIR, 'Antigravity', 'agy_zhcn_ui_main.js')

    print("\n========================================================")
    print("           Antigravity 汉化环境与状态检测")
    print("========================================================")
    print(f"安装路径 : {target_app_dir}")
    print(f"核心文件 : {'存在' if os.path.exists(asar_path) else '未找到'}")
    print(f"备份状态 : {'存在备份' if os.path.exists(backup_path) else '无备份'}")
    print(f"UI注入包 : {'已部署' if os.path.exists(bundle_path) else '未部署'}")
    
    with open(DICT_PATH, 'r', encoding='utf-8') as f:
        dict_data = json.load(f)
    print(f"词库规模 : {len(dict_data.get('exact', {}))} 条精确词条 + {len(dict_data.get('patterns', []))} 组正则")
    print("========================================================\n")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Antigravity Desktop 汉化与恢复引擎")
    parser.add_argument('--install', action='store_true', help='执行汉化安装')
    parser.add_argument('--restore', action='store_true', help='恢复官方英文')
    parser.add_argument('--check', action='store_true', help='检查当前状态')
    parser.add_argument('--app-dir', type=str, default=None, help='指定 Antigravity 安装目录')
    parser.add_argument('--bundle-target', type=str, default=None, help='指定 UI Bundle 路径')

    args = parser.parse_args()
    if args.restore:
        do_restore(args.app_dir, args.bundle_target)
    elif args.check:
        do_check(args.app_dir)
    else:
        do_install(args.app_dir, args.bundle_target)
