import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { getStateRoot } from "./paths.mjs";

export const LATEST_RELEASE_URL =
  "https://github.com/chenmo00000/antigravity-desktop-zhcn/releases/latest";

const adviceRules = [
  {
    pattern: /AGY_INSTALL_PATH|未找到有效的 Antigravity Desktop 安装目录/,
    advice:
      "确认已安装独立版 Antigravity Desktop；如果是便携安装，请设置 AGY_INSTALL_PATH。",
  },
  {
    pattern: /UI 端口|先打开 Antigravity|ECONNREFUSED|读取运行时 UI 超时/,
    advice: "打开 Antigravity 并等待主界面完全加载，然后重试。",
  },
  {
    pattern: /白名单|尚未登记|指纹不匹配|未通过兼容性检查/,
    advice: `当前客户端不能安全安装。请先从 ${LATEST_RELEASE_URL} 下载最新版并重新检查；如果最新版仍不支持，再把版本与哈希信息提交给维护者。`,
  },
  {
    pattern: /EACCES|EPERM|resource busy|权限|拒绝访问/i,
    advice:
      "彻底关闭 Antigravity 后重试；仍然失败时，再使用管理员身份运行。",
  },
  {
    pattern: /ENOSPC|空间不足/i,
    advice: "释放系统盘空间后重试；备份文件不会被自动删除。",
  },
  {
    pattern: /备份.*哈希|回滚.*失败/,
    advice:
      "不要启动 Antigravity，也不要手动删除备份；请保留日志并联系维护者。",
  },
  {
    pattern: /本地中文 UI 文件已被修改|无法安全删除/,
    advice:
      "工具保留了备份和状态以避免误删未知文件。请先核对提示的文件，再联系维护者处理。",
  },
];

function collectErrorText(error) {
  if (error instanceof AggregateError) {
    return [error.message, ...error.errors.map(collectErrorText)].join("\n");
  }
  return `${error?.message ?? error ?? "未知错误"}\n${error?.code ?? ""}`;
}

export function getErrorAdvice(error) {
  const text = collectErrorText(error);
  return (
    adviceRules.find((rule) => rule.pattern.test(text))?.advice ??
    "请保留错误日志并在项目 Issues 中反馈；不要手动修改 app.asar。"
  );
}

export async function writeDiagnosticLog({ action, error }) {
  const logDirectory = path.join(getStateRoot(), "logs");
  const logPath = path.join(logDirectory, "cli-errors.log");
  const details = error?.stack ?? collectErrorText(error);
  const entry = [
    "",
    "============================================================",
    new Date().toISOString(),
    `action=${action}`,
    `platform=${process.platform}`,
    `arch=${process.arch}`,
    `node=${process.version}`,
    details,
    "",
  ].join("\n");

  await mkdir(logDirectory, { recursive: true });
  await appendFile(logPath, entry, "utf8");
  return logPath;
}
