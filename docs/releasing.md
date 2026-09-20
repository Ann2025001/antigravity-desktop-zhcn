# GitHub 发布

## 自动检查

`.github/workflows/ci.yml` 会在 `main` 推送、Pull Request 和手动触发时，在
Windows 与 Node.js 22.12.0 上执行：

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run validate
```

项目校验同时检查六个 BAT 的 CRLF、便携运行时入口、工作流所需命令，以及仓库中
远程兼容清单的 Ed25519 签名。
Dependabot 每月检查 npm 锁文件和 GitHub Actions 主版本更新。

## 便携包

本地构建：

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run build:portable
```

产物位于 `.runtime/release`：

- `antigravity-desktop-zhcn-portable-win-x64.zip`
- `antigravity-desktop-zhcn-portable-win-x64.zip.sha256`

构建脚本从 `nodejs.org` 临时下载锁定的 Node.js 22.12.0 Windows x64 ZIP，并使用
官方 `SHASUMS256.txt` 校验下载文件。发布包只包含 `node.exe` 和 Node 许可证，下载
临时目录会在成功或失败后清理。生产依赖来自当前 `package-lock.json`，构建前必须
已通过 `npm ci` 安装。

便携包会包含兼容信任配置、已签名清单及验签代码，但绝不能包含签名私钥。构建后应
检查 ZIP 条目，确认不存在 `.runtime`、`.pem` 或 signing 目录。

## GitHub Release

`.github/workflows/release.yml` 支持手动运行并上传 Actions Artifact。推送 `v*` 标签
时，还会使用仓库的 `GITHUB_TOKEN` 创建对应 Release，上传 ZIP 和 SHA-256 文件，
并根据兼容配置自动在 Release 说明顶部列出全部支持版本。

发布前仍需人工确认：

1. 支持版本与 `config/compatibility/<客户端版本>/<平台>-<架构>.json` 一致；
2. `npm test` 和 `npm run validate` 通过；
3. 使用便携包内置 `runtime/node.exe` 成功运行兼容性检查；
4. Release 页面说明未知版本会被拒绝，不承诺模糊兼容。
5. `npm run compatibility:verify` 已通过，签名清单未过期且序列号高于上一版。

## 版本兼容策略

- `main` 保存全部仍受支持的 Antigravity Desktop 版本；普通用户始终下载最新
  Release 中的同一个 portable ZIP，不按客户端版本维护下载分支。
- 适配新客户端时可以使用临时分支，验证完成后合并回 `main` 并删除临时分支。
- `config/compatibility/<客户端版本>/<平台>-<架构>.json` 的每一项代表一个经过验证
  的具体构建。同一平台、架构和客户端版本可以登记多个不同的 `appAsarSha256`，用于
  处理官方同版本重新打包；完全相同的构建指纹不能重复。
- 新客户端版本必须重新采集 ASAR、customScheme 和运行时 UI 指纹。只有 UI 文本或
  结构发生变化时才需要扩充翻译词典。
- 已经包含此公钥验签机制的便携包，可以从固定 HTTPS 地址获取后来新增的已签名精确
  指纹；验签或网络失败时只使用已验证缓存或内置白名单。翻译代码和词典不会通过该
  通道远程更新。
- 汉化工具自身使用独立版本号和 `v*` 标签；发布说明应列出该工具版本支持的全部
  客户端版本，不为每个客户端版本单独制作 ZIP。
