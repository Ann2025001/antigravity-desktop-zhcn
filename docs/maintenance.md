# 新版本维护

1. 安装新的官方 Antigravity Desktop，确认客户端未安装本项目补丁。
2. 打开客户端并等待主界面加载，然后运行：

   ```powershell
   npm run collect:compatibility
   ```

   如需离线采集，可使用：

   ```powershell
   node scripts/collect-compatibility-candidate.mjs `
     --asar "D:\path\to\app.asar" `
     --ui-bundle "D:\path\to\main.js" `
     --custom-scheme "dist/customScheme.js"
   ```

3. 检查 `.runtime/compatibility-candidates` 中的候选文件。候选始终带
   `status: "candidate"` 和 `UNVERIFIED`，采集工具不会修改白名单。
4. 将候选指纹与官方安装包来源、签名和版本信息交叉核对。
5. 在不修改客户端的环境下运行 `preview`，核对 DOM 词典发现数量，并逐屏检查
   导航、设置、权限和账户页面。
6. 在 `app.asar` 副本上构建补丁，验证：
   - 内部版本未变化；
   - 原始 `plugin://` 处理仍然存在；
   - 新增 `agy-zhcn://` 处理存在；
   - 新 ASAR 可重新读取；
   - `node --check` 通过。
7. 只有完成真实启动、恢复和自动更新边界测试后，才能把新指纹加入
   `config/compatibility/<客户端版本>/<平台>-<架构>.json`。同一版本和平台存在多个
   官方构建时，在该文件的 `targets` 数组中分别登记其精确指纹。
8. 使用离线保存的 Ed25519 私钥生成新的远程兼容清单。序列号必须严格递增：

   ```powershell
   npm run compatibility:sign -- --sequence <上一序列号加一> --expires-days 180
   npm run compatibility:verify
   ```

   提交本地兼容分片、`config/remote/compatibility-manifest.json` 和对应 `.sig`。CI 会
   再次验签；不要只更新清单或只更新签名。
9. 在官方原始客户端上运行 `npm run check`、`npm run preview`、安装与恢复测试，然后
   才能发布远程清单或新版便携包。

兼容性图谱是精确白名单，不是“看起来相近”的版本范围。

## 签名密钥管理

- 默认私钥路径是 `.runtime/signing/compatibility-ed25519-private.pem`，该目录和 `*.pem`
  都已被 Git 忽略；也可以通过 `AGY_COMPATIBILITY_SIGNING_KEY` 指定外部路径。
- 私钥必须离线备份到受保护的位置，不得提交到 Git、放入便携 ZIP、Issue、日志或聊天。
- `config/compatibility-trust.json` 只包含公钥和固定下载地址，可以公开分发。
- 丢失私钥后无法继续为现有便携包发布可信清单；轮换公钥必须发布包含新公钥的新版工具。
- 发布前检查 ZIP 文件列表，确认不含 `.runtime`、`.pem` 或任何 signing 目录。
