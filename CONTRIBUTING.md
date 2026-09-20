# 贡献指南 (Contributing Guide)

欢迎参与 **Antigravity Desktop 中文本地化项目**！

本项目致力于为 Google Antigravity Desktop 提供高质量、安全、无损还原的中文体验。我们非常欢迎社区共同提交漏翻词条、翻译改进、新版适配与 Bug 修复。

---

## 📜 项目来源与开源协议

本项目是在社区开源项目 [chenmo00000/antigravity-desktop-zhcn](https://github.com/chenmo00000/antigravity-desktop-zhcn) 的基础上继续迭代、修复和扩展，遵循 [MIT License](LICENSE) 协议开源。由衷感谢原项目与所有早期贡献者的基础工作。

---

## 🤝 参与贡献的方式

### 方式一：反馈漏翻、翻译优化或新版本适配（无需编写代码）

如果您在使用过程中发现了遗漏的英文、排版显示问题，或者 Antigravity 推送了新版本：
1. 前往项目的 [Issues 页面](../../issues/new/choose)；
2. 选择对应的模板：
   - **🔍 漏翻 / 翻译优化建议**：提供英文原文、截图、所在界面位置及建议的中文；
   - **📦 新版本兼容性适配请求**：提供 Antigravity 版本号、操作系统及 `一键检查兼容性.bat` 的输出信息；
   - **🐞 工具运行问题反馈**：反馈安装、运行或还原过程中的异常。
3. **⚠️ 隐私与安全提醒**：
   - 截图中请务必遮盖个人邮箱、对话正文、Token、API Key 及敏感项目路径；
   - 严禁在 Issue 中上传任何机密或隐私数据。

---

### 方式二：提交 Pull Request 直接贡献词条或代码

如果您希望直接修改词典或完善工具功能：

#### 1. 准备本地开发环境
- 安装 **Node.js >= 22.12.0** 与 **npm**；
- Fork 本仓库并 Clone 到本地；
- 在项目根目录执行：
  ```powershell
  npm ci --ignore-scripts --no-audit --no-fund
  ```

#### 2. 添加或修改翻译词条
- 编辑 [`config/dom-translations.json`](config/dom-translations.json)：
  - **静态固定文本**：添加至 `"exact"` 哈希表中（例如 `"Feedback Type": "反馈类型"`）；
  - **动态变量文本**：添加至 `"patterns"` 数组中，并使用严格窄正则（例如 `"^Send feedback as (.+)$"` $\rightarrow$ `"以 $1 身份发送反馈"`）。
- **词条规范**：
  - 必须保持单向 English $\rightarrow$ Chinese 翻译；
  - 避免添加同值映射（如 `"Token": "Token"`）；
  - 避免定义过于宽泛的单词级全局规则，防止污染其他正常技术标识符；
  - 官方技术术语、品牌名（如 `Gemini`、`MCP`、`IDE`、`GitHub`、`URL`）应保留纯英文原样。

#### 3. 运行本地质量门校验
提交代码前，必须确保本地所有测试与结构校验 100% 通过：
```powershell
# 运行全部单元测试
npm test

# 运行词库结构与代码语法校验
npm run validate
```

#### 4. 提交 Commit 与 Pull Request
- Commit 信息建议遵循 Conventional Commits（例如 `feat: localize feedback page` 或 `fix: tighten permission patterns`）；
- 推送至您的 Fork 分支并发起 Pull Request；
- GitHub Actions CI 会自动对 PR 进行语法与单元测试验证。

---

感谢每一位为 Antigravity 中文化做出贡献的开发者与用户！
