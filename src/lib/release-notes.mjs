function compareVersionsDescending(left, right) {
  return right.localeCompare(left, undefined, { numeric: true });
}

function formatPlatform(platform) {
  if (platform === "win32") return "Windows";
  return platform;
}

export function buildReleaseCompatibilityNotes(manifest) {
  if (!manifest || !Array.isArray(manifest.targets)) {
    throw new Error("无法生成 Release 兼容版本说明。");
  }

  const groups = new Map();
  for (const target of manifest.targets) {
    const key = `${target.appVersion}/${target.platform}/${target.arch}`;
    const group = groups.get(key) ?? {
      appVersion: target.appVersion,
      platform: target.platform,
      arch: target.arch,
      builds: new Set(),
    };
    group.builds.add(target.appAsarSha256);
    groups.set(key, group);
  }

  const supported = [...groups.values()].sort(
    (left, right) =>
      compareVersionsDescending(left.appVersion, right.appVersion) ||
      left.platform.localeCompare(right.platform) ||
      left.arch.localeCompare(right.arch),
  );
  if (supported.length === 0) {
    throw new Error("兼容性清单没有可发布的目标版本。");
  }

  const lines = [
    "## 🚀 Antigravity Desktop 中文汉化补丁 v1.0.0",
    "",
    "面向 Windows 版 Google Antigravity Desktop 的中文本地化补丁工具正式发布。",
    "",
    "### 🌟 本次发布核心亮点",
    "",
    "- **全面汉化覆盖**：内置 1426 条精确翻译规则与 169 条动态正则匹配规则，深度覆盖主界面、设置菜单、权限预设、快捷键面板与交互弹窗。",
    "- **原生菜单与托盘支持**：除 DOM 渲染层外，新增对 Electron 主进程系统托盘（System Tray）与原生上下文菜单的自动汉化注入。",
    "- **安全指纹与无损还原**：基于客户端 `app.asar` SHA-256 哈希进行严格版本白名单匹配；首次安装自动备份官方原版，支持一键无损恢复英文。",
    "- **开箱即用便携包**：发布包内置独立的 Node.js 运行时与锁定依赖，普通用户无需配置任何开发环境即可直接运行。",
    "- **自动化维护体系**：内置 Untranslated Collector 未翻译 UI 发现体系与 CI 自动化校验，支持社区协同持续跟进官方后续新版本。",
    "",
    "### 📦 支持的 Antigravity Desktop 版本",
    "",
    "请下载本 Release 中的通用 portable ZIP 便携包 `antigravity-desktop-zhcn-portable-win-x64.zip`。工具会自动识别客户端版本和具体构建指纹，无需手动选择对应版本。",
    "",
  ];
  for (const group of supported) {
    const buildText =
      group.builds.size > 1 ? `，${group.builds.size} 个已验证构建` : "";
    lines.push(
      `- \`${group.appVersion}\` / ${formatPlatform(group.platform)} ${group.arch}${buildText}`,
    );
  }
  lines.push(
    "",
    "> [!NOTE]",
    "> 若检测到未收录的客户端版本或文件指纹不匹配，工具会主动安全停止并拦截注入，绝不强行修改文件，确保客户端安全稳定。",
    "",
    "### 📜 项目来源与致谢",
    "",
    "本项目基于社区开源项目 [chenmo00000/antigravity-desktop-zhcn](https://github.com/chenmo00000/antigravity-desktop-zhcn) 继续迭代、修复与扩展，遵循 MIT License 开源。感谢原作者与社区贡献者！",
  );
  return lines.join("\n");
}
