# Antigravity Desktop 中文汉化优化版

面向 Windows 版 Google Antigravity Desktop 的全量深度中文本地化工具。

> **支持最新 Antigravity 2.15.0+，已全量扩充至 1316 条精确中英词典与 146 组动态正则规则，无死角覆盖二级设置菜单、权限预设、快捷键与各类模态弹窗。**

## 下载与安装

### 1. 下载最新版

**[⬇️ 访问 GitHub 仓库 Releases 页面下载](https://github.com/Ann2025001/antigravity-desktop-zhcn)**

### 2. 完整解压

右键下载的 ZIP，选择“全部解压缩”。不要直接在压缩包预览窗口中运行 BAT 文件。

### 3. 一键汉化

1. 双击 `一键汉化.bat`；
2. 工具自动检查环境、查找安装目录并核对版本与文件指纹；
3. 如果需要运行时 UI，工具会自动打开 Antigravity，请等待主界面加载；
4. 确认安装后，按提示彻底关闭 Antigravity；
5. 工具自动备份、安装并复检，完成后重新打开客户端。

当前支持 `Antigravity Desktop 2.15.0、2.14.0、2.13.0、2.12.2、2.12.0、2.11.0、2.10.0、2.9.1、2.8.1、2.7.1、2.6.0、2.5.0、2.4.3、2.3.1、2.3.0、2.2.1 / Windows x64`。
这些版本都使用上面的同一个 ZIP，工具会自动识别本机版本和具体构建指纹。同一个
版本号如果存在多个官方构建，也可以分别登记并精确匹配。

工具不会自动结束 Antigravity 进程，也不会绕过未知版本或未知文件指纹。需要先做
诊断时，可以运行 `一键检查兼容性.bat`；普通安装不再要求手动依次执行检查和预览。

需要恢复时，彻底关闭 Antigravity，然后双击 `一键恢复英文.bat`。

项目采用严格版本和文件指纹白名单；内置规则之外，还会通过 HTTPS 获取维护者签名
的兼容清单，并使用便携包内置的 Ed25519 公钥验签。网络不可用、清单过期、签名错误
或远程规则与内置规则冲突时会安全退回内置白名单，不会尝试“强行兼容”。仓库内部的兼容规则按
`config/compatibility/<客户端版本>/<平台>-<架构>.json` 组织；这种拆分只用于维护，
不会改变普通用户的一键使用流程。

## 六个 BAT 的区别

| 文件 | 是否修改客户端 | 用途 |
| --- | --- | --- |
| `一键检查兼容性.bat` | 否 | 检查版本、ASAR、补丁入口和运行时 UI 指纹 |
| `生成汉化预览.bat` | 否 | 在 `.runtime` 生成并检查本地中文 UI |
| `一键汉化.bat` | 是 | 备份原始 ASAR，安装验证过的补丁和中文 UI |
| `一键恢复英文.bat` | 是 | 仅在版本与安装状态完全匹配时恢复原始备份 |
| `清理缓存.bat` | 否 | 清理可再生成的预览、UI 缓存和遗留临时构建目录 |
| `完全卸载.bat` | 是 | 必要时先恢复英文，再永久删除本工具的备份、状态、日志和缓存 |

## 运行要求

- Windows 10/11 x64
- Antigravity Desktop 2.14.0、2.13.0、2.12.2、2.12.0、2.11.0、2.10.0、2.9.1、2.8.1、2.7.1、2.6.0、2.5.0、2.4.3、2.3.1、2.3.0 或 2.2.1
- 使用 portable 发布包：无需另装 Node.js，安装过程无需下载 npm 依赖
- 直接使用源码：需要 Node.js 22.12 或更高版本

源码方式下，检查和生成预览不需要安装 npm 依赖。首次实际安装时，BAT 会自动执行
`npm ci --ignore-scripts`，严格按照 `package-lock.json` 下载
`@electron/asar@4.2.1`。portable 包已经内置锁定的 Node 和生产依赖。

使用历史版本时，建议先把 Antigravity 的更新模式设为手动或关闭，避免客户端自动
升级后覆盖补丁。升级到未列出的版本后，应先重新运行兼容性检查。

遇到尚未登记的版本或构建时，先保持联网并重新运行兼容性检查；包含此验签机制的工具
可以读取维护者后来发布且已签名的精确指纹。若远程清单尚未收录，工具会显示最新版 Release
地址，此时再把兼容性检查显示的版本和哈希信息提交给维护者。客户端 UI 结构或翻译
词典发生变化时，仍可能需要下载新版工具。

## 安装目录怎么找到

安装目录没有写死。工具会按以下顺序自动查找：

1. 用户设置的 `AGY_INSTALL_PATH`；
2. 正在运行的 `Antigravity.exe`；
3. Windows 卸载注册表中的 Antigravity Desktop；
4. `%LOCALAPPDATA%\Programs\Antigravity` 默认目录。

每个候选目录都必须同时包含 `Antigravity.exe` 和 `resources\app.asar`，因此不会
把 Antigravity IDE 当成 Desktop。发现多个同优先级的有效目录时，工具会停止并
提示设置 `AGY_INSTALL_PATH`，不会随意选择。兼容性检查输出也会显示路径来源。

## 出错与清理

失败时会同时显示“错误原因”和“建议操作”。完整技术日志保存在
`%LOCALAPPDATA%\AntigravityZhcn\logs\cli-errors.log`，便于提交 Issue。

`清理缓存.bat` 在删除前会列出路径和大小，并要求确认。它只清理可以重新生成的
预览、开发验证副本、运行时 UI 缓存、安装准备文件和中断遗留的临时构建目录，
不会删除：

- 原始 `app.asar` 备份；
- 安装/恢复状态；
- 已安装的中文 UI；
- Antigravity 客户端或用户数据；
- npm 全局缓存。

彻底不再使用本工具时，运行 `完全卸载.bat`。它会先核验当前状态；如果汉化仍在
使用，会先从已验证备份恢复英文，然后永久清除本工具的备份、状态、日志与缓存。
删除前会列出具体路径和大小并要求确认。完成后，可手动删除解压出的工具文件夹。
它不会删除 Antigravity 的账户、会话、设置或其他用户数据。

## 汉化原理

工具不会在压缩后的 React bundle 中批量替换英文，也不会修改 `"running"`、
`"completed"` 等可能参与程序逻辑的状态值。

安装后，Antigravity 仍加载经过指纹验证的原始 `main.js`，本项目只在文件末尾追加
一个 DOM 中文覆盖层。覆盖层：

- 只处理页面文本节点，以及 `aria-label`、`title`、`placeholder`；
- 跳过代码、编辑器、输入框和 `contenteditable` 区域；
- 通过 `MutationObserver` 处理后续渲染的界面；
- 不修改请求参数、状态对象、模型返回内容或本地项目文件。

为加载本地 UI，安装器会在验证过的 `dist/customScheme.js` 中注册
`agy-zhcn://`，并只重定向 Antigravity 本地服务的 `/main.js`。

## 安全与回滚

- 支持版本、`app.asar`、`customScheme.js` 和运行时 UI 四重 SHA-256 校验。
- 远程兼容清单必须通过 Ed25519 签名、有效期、序列号回退防护和规则冲突检查。
- 验证通过的远程清单缓存在 `%LOCALAPPDATA%\AntigravityZhcn\compatibility`；离线时
  只能使用仍在有效期内且已验签的缓存或内置白名单。
- 每次构建使用全新的系统临时目录，不复用旧解包目录。
- 原始 `app.asar` 按版本和哈希保存在
  `%LOCALAPPDATA%\AntigravityZhcn\backups`。
- 新 ASAR 在替换前后都会校验哈希，并采用同目录原子重命名。
- 恢复必须同时匹配客户端版本、当前补丁哈希和原始备份哈希。
- 客户端自动更新后不会跨版本恢复旧 ASAR。

## 开发命令

```powershell
npm ci --ignore-scripts
npm run validate
npm test
npm run check
npm run preview
npm run cleanup
npm run purge
npm run collect:compatibility
npm run compatibility:verify
npm run release:notes
npm run build:portable
```

`npm run collect:compatibility` 只生成带 `UNVERIFIED` 标记的候选 JSON，不会自动
修改严格白名单。发布与维护步骤见 [`docs/maintenance.md`](docs/maintenance.md) 和
[`docs/releasing.md`](docs/releasing.md)。

环境变量：

- `AGY_INSTALL_PATH`：自动查找失败、存在多个安装目录或需要覆盖结果时，明确指定
  Antigravity Desktop 安装目录。
- `AGY_ZHCN_STATE_DIR`：覆盖缓存、备份和安装状态目录。
- `AGY_USER_DATA_PATH`：覆盖 Antigravity 用户数据目录。
- `AGY_DISABLE_REMOTE_COMPATIBILITY=1`：本次运行不联网检查远程兼容清单；仍可使用
  已验签且有效的本地缓存，否则只使用内置白名单。

## 项目边界

本项目只支持独立的 Antigravity Desktop，不支持 Antigravity IDE。

项目不包含、不上传也不分发 Google 的安装包、`app.asar`、原始运行时 `main.js`
或其他专有资源。本项目及中文词典均由社区独立研发和维护，不隶属于 Google，
Antigravity、Google 及相关商标和软件权利归各自权利人所有。

## 致谢与开源协议

本项目基于 [chenmo00000/antigravity-desktop-zhcn](https://github.com/chenmo00000/antigravity-desktop-zhcn) 进行 Antigravity 2.15.0+ 深度全量汉化与架构升级，遵循 [MIT License](LICENSE) 协议开源。

