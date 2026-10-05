import fs from "node:fs";
import path from "node:path";

const dictPath = "config/dom-translations.json";
const dict = JSON.parse(fs.readFileSync(dictPath, "utf8"));

// 1. 用户截图中的模型配额说明与设置文本（核心优先级）
const quotaAndUsageTranslations = {
  "Within each group, models share a weekly limit and a 5-hour limit. Quota is consumed proportionally to the cost of the tokens. Thus, limits will last longer with shorter tasks or using more cost-effective models. The 5-hour limit smooths out aggregate demand to fairly distribute global capacity across all users, while your weekly limit is tied directly to your individual tier.":
    "在每个组内，模型共享每周限额和 5 小时限额。配额根据 Token 的消耗成本按比例扣减。因此，对于耗时较短的任务或使用更高性价比的模型，配额使用时间将更持久。5 小时限额用于平滑总体请求峰值，以在所有用户间公平分配全局算力；而你的每周限额则直接与你的个人套餐级别挂钩。",
  "Within each group, models share a weekly limit and a 5-hour limit.":
    "在每个组内，模型共享每周限额和 5 小时限额。",
  "Quota is consumed proportionally to the cost of the tokens.":
    "配额根据 Token 的消耗成本按比例扣减。",
  "Thus, limits will last longer with shorter tasks or using more cost-effective models.":
    "因此，对于耗时较短的任务或使用更高性价比的模型，配额使用时间将更持久。",
  "The 5-hour limit smooths out aggregate demand to fairly distribute global capacity across all users, while your weekly limit is tied directly to your individual tier.":
    "5 小时限额用于平滑总体请求峰值，以在所有用户间公平分配全局算力；而你的每周限额则直接与你的个人套餐级别挂钩。",
  "For Antigravity Business consumption options, see":
    "有关 Antigravity Business 的用量与计费选项，请参阅",
  "documentation": "官方文档",
  "documentation.": "官方文档。",
  "Refresh quota and credits data": "刷新配额与点数数据",
  "Enable AI Credit Overages": "允许超额使用 AI 点数",
  "Available AI Credits:": "可用 AI 点数：",
  "See Activity": "查看活动记录",
  "Get More AI Credits": "获取更多 AI 点数",
  "Shared with:": "共享对象：",
  "Your quota for this model is running low.": "你在此模型的配额即将耗尽。",
  "No quota information available.": "暂无可用配额信息。",
  "No quota information available for this model.": "此模型暂无可用配额信息。",
  "No quota information available": "暂无可用配额信息",
  "Model Quota": "模型配额",
  "Model quota": "模型配额",
  "Model Credits": "模型点数",
  "Model credits": "模型点数",
  "Models & Usage": "模型与用量",
  "Manage your model quota and credits.": "管理你的模型配额与点数。",
  "Manage your notification preferences.": "管理你的通知偏好设置。"
};

// 2. 穷举提取的大量系统 UI、工件、设置与交互文本
const comprehensiveUiTranslations = {
  "A Google Cloud project is required to use Antigravity.":
    "使用 Antigravity 需要关联一个 Google Cloud 项目。",
  "A chunk is a section of the page. Long pages are chunked so that only the sections that are relevant to your query are read.":
    "块是页面的一部分。长页面会被分块，以便仅读取与你的查询相关的部分。",
  "A copy of the workspace snapshot recorded at this step.":
    "在此步骤记录的工作区快照副本。",
  "A full copy of this workspace, uncommitted changes included.":
    "此工作区的完整副本，包含未提交的更改。",
  "A license or project selection is required to use Antigravity.":
    "使用 Antigravity 需要选择许可证或项目。",
  "A new version is available.": "发现新版本可用。",
  "A non-root actor cannot be stopped directly.": "非根参与者无法直接停止。",
  "A snapshot was saved before running. To restore your previous output:":
    "运行前已保存快照。若要恢复之前的输出：",
  "A subtler version of list hover background.": "列表悬停背景的柔和样式。",
  "ABFS workspace creation feature is not available.": "ABFS 工作区创建功能不可用。",
  "ABFS workspace creation is not available in this environment.":
    "当前环境中不支持创建 ABFS 工作区。",
  "Account connected.": "账户已连接。",
  "Action List background color for the focused item.": "聚焦项的快捷操作列表背景色。",
  "Action List background color.": "快捷操作列表背景色。",
  "Action List foreground color for the focused item.": "聚焦项的快捷操作列表前景色。",
  "Action List foreground color.": "快捷操作列表前景色。",
  "Address CLs needing attention": "处理需要注意的修改清单 (CL)",
  "All ports have been leased.": "所有可用端口均已被占用。",
  "Allow Gemini to notify you when the agent needs your attention or completes a task.":
    "当智能体需要你的注意或完成任务时，允许 Gemini 发送通知。",
  "Amend": "修补提交 (Amend)",
  "An error occurred while checking the port. Please try again.":
    "检查端口时发生错误，请重试。",
  "An error occurred while submitting your feedback. Please try again.":
    "提交反馈时发生错误，请重试。",
  "An error was thrown.": "抛出了一个错误。",
  "An extra border around active elements to separate them from others for greater contrast.":
    "活动元素周围的额外边框，用于与其它元素区分以获得更强的对比度。",
  "An unexpected bug occurred.": "发生了意外错误。",
  "An unexpected error occurred while attempting to send frame over socket.":
    "尝试通过套接字发送帧时发生意外错误。",
  "Archive / Restore": "归档 / 恢复",
  "Archived Only": "仅查看已归档",
  "Arguments Schema": "参数架构 (Schema)",
  "Artifact Comments": "工件批注",
  "Artifact Name": "工件名称",
  "Artifacts are created when the agent performs more complex, longer running tasks while in Planning mode.":
    "在规划模式下，当智能体执行更复杂、耗时更长的任务时，会创建工件。",
  "Artifacts like Google Docs, PDFs, Office documents (Word, Excel, PowerPoint), etc. Everything else the agent creates is under Artifacts.":
    "如 Google 文档、PDF、Office 文档（Word、Excel、PowerPoint）等文件。智能体创建的其他所有内容均位于工件中。",
  "Ask before sensitive operations.": "在执行敏感操作前进行确认。",
  "Authenticated as": "当前认证身份为",
  "Authenticating...": "正在验证身份...",
  "Authentication Required": "需要身份验证",
  "Auto (Preview)": "自动（预览版）",
  "Automatically decide if commands run.": "由系统自动决定是否执行命令。",
  "Available for": "适用于",
  "Axis color for the chart.": "图表坐标轴颜色。",
  "Back to licenses": "返回许可证列表",
  "Background color for block quotes in text.": "文本中块引用的背景颜色。",
  "Background color for code blocks in text.": "文本中代码块的背景颜色。",
  "Background color for lines that got inserted. The color must not be opaque so as not to hide underlying decorations.":
    "新增行的背景颜色。颜色必须半透明，以免遮挡下方的标记装饰。",
  "Background color for lines that got removed. The color must not be opaque so as not to hide underlying decorations.":
    "被删除行的背景颜色。颜色必须半透明，以免遮挡下方的标记装饰。",
  "Background color for the active tab.": "活动标签页的背景颜色。",
  "Background color for the editor gutter.": "编辑器行号槽的背景颜色。",
  "Background color of highlighted content.": "高亮内容的背景颜色。",
  "Badge background color.": "徽标背景颜色。",
  "Badge foreground color.": "徽标前景色。",
  "Base directory for artifacts": "工件的基础保存目录",
  "Batch execution completed": "批量执行已完成",
  "Best of N mode is not available": "多方案优选 (Best of N) 模式不可用",
  "Best of N settings have moved": "Best of N 设置已迁移",
  "Border color for active elements.": "活动元素的边框颜色。",
  "Border color for block quotes in text.": "文本中块引用的边框颜色。",
  "Border color for code blocks in text.": "文本中代码块的边框颜色。",
  "Border color for table headers.": "表头的边框颜色。",
  "Border color for table rows.": "表格行的边框颜色。",
  "Border color of elements.": "元素边框颜色。",
  "Browse all available settings": "浏览所有可用设置",
  "Can be added to conversations from the @-menu.": "可从 @ 菜单中添加到对话中。",
  "Cannot open file": "无法打开文件",
  "Cannot read workspace directory": "无法读取工作区目录",
  "Check for newer versions automatically": "自动检查新版本",
  "Check your network connection and try again": "请检查你的网络连接并重试",
  "Choose a conversation to view": "选择一个对话以查看",
  "Choose a directory to open": "选择要打开的目录",
  "Clear chat history": "清空对话历史",
  "Clear recent projects": "清除最近项目记录",
  "Clear terminal output": "清空终端输出",
  "Collapse all sections": "折叠所有区域",
  "Command execution timed out": "命令执行超时",
  "Configuration saved successfully": "配置保存成功",
  "Confirm password": "确认密码",
  "Connection lost, reconnecting...": "连接丢失，正在重新连接...",
  "Continue without saving": "不保存并继续",
  "Copied snippet to clipboard": "已复制代码片段到剪贴板",
  "Copy link to message": "复制消息链接",
  "Create a new scratch file": "新建临时文件 (Scratch File)",
  "Current Workspace": "当前工作区",
  "Custom Instructions": "自定义系统指令",
  "Decrease font size": "缩小字体大小",
  "Default shell executable": "默认终端 Shell 执行程序",
  "Discard changes and reset": "放弃更改并重置",
  "Download completed": "下载完成",
  "Enable experimental features": "启用实验性功能",
  "Expand all sections": "展开所有区域",
  "Export conversation as Markdown": "将对话导出为 Markdown",
  "Failed to load project configuration": "加载项目配置失败",
  "Feedback submitted successfully!": "反馈提交成功！",
  "Global customization rules": "全局自定义规则",
  "Increase font size": "放大字体大小",
  "Installed Extensions": "已安装的扩展",
  "Manage extensions and plugins": "管理扩展与插件",
  "No matching results found": "未找到匹配的结果",
  "Open settings file": "打开配置文件",
  "Press Enter to confirm": "按 Enter 确认",
  "Press Esc to cancel": "按 Esc 取消",
  "Reload window to apply changes": "重新加载窗口以应用更改",
  "Reset to default settings": "重置为默认设置",
  "Save changes before closing?": "关闭前是否保存更改？",
  "Select a branch to switch": "选择要切换的分支",
  "Show hidden files": "显示隐藏文件",
  "Toggle sidebar": "切换侧边栏显示",
  "View system logs": "查看系统日志",
  "Working directory": "工作目录",
  "Workspace settings override global settings.": "工作区设置将覆盖全局设置。"
};

// 3. 动态模式规则：针对各种配额、时间、比例、限制等泛化模式
const newPatterns = [
  {
    source: "^Shared with:?\\s*(.+)$",
    target: "共享对象：$1",
    flags: "u"
  },
  {
    source: "^Available AI Credits:?\\s*([0-9,]+)$",
    target: "可用 AI 点数：$1",
    flags: "u"
  },
  {
    source: "^Resets in (\\d+)d(?:\\s*(\\d+)h)?$",
    target: "将在 $1 天$2 小时后重置",
    flags: "u"
  },
  {
    source: "^Resets in (\\d+)h(?:\\s*(\\d+)m)?$",
    target: "将在 $1 小时$2 分钟后重置",
    flags: "u"
  },
  {
    source: "^Within each group, models share a (.+?) and a (.+?)\\.$",
    target: "在每个组内，模型共享 $1 和 $2。",
    flags: "u"
  }
];

// 合并精确词典
let exactCount = 0;
for (const [k, v] of Object.entries(quotaAndUsageTranslations)) {
  dict.exact[k] = v;
  exactCount++;
}
for (const [k, v] of Object.entries(comprehensiveUiTranslations)) {
  dict.exact[k] = v;
  exactCount++;
}

// 合并动态模式
const existingSources = new Set(dict.patterns.map((p) => p.source));
let patternCount = 0;
for (const p of newPatterns) {
  if (!existingSources.has(p.source)) {
    dict.patterns.push(p);
    patternCount++;
  }
}

fs.writeFileSync(dictPath, JSON.stringify(dict, null, 2) + "\n", "utf8");
console.log(`成功写入 ${exactCount} 条精确词条与 ${patternCount} 条动态泛化规则！`);
