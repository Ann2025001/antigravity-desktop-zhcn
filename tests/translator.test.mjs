import assert from "node:assert/strict";
import test from "node:test";
import {
  countBundleDictionaryHits,
  createLocalizedBundle,
  createRuntimeOverlay,
  loadDomTranslations,
  translateDictionaryValue,
} from "../src/lib/translator.mjs";

const dictionary = {
  schemaVersion: 2,
  exact: {
    Settings: "设置",
    "New Conversation": "新建对话",
  },
  patterns: [
    {
      source:
        "^Quota refreshes in ([0-9]+) hours?, ([0-9]+) minutes?\\.$",
      target: "额度将在 $1 小时 $2 分钟后恢复。",
      flags: "u",
    },
  ],
};

test("runtime overlay keeps the original bundle unchanged", () => {
  const source = Buffer.from(
    `const state = "Settings"; console.log("New Conversation");`,
    "utf8",
  );
  const localized = createLocalizedBundle(source, dictionary);
  const output = localized.buffer.toString("utf8");

  assert.ok(output.startsWith(source.toString("utf8")));
  assert.match(output, /const state = "Settings"/);
  assert.match(output, /exactTranslations/);
  assert.match(output, /patternTranslations/);
  assert.equal(localized.coverage.hits, 2);
});

test("runtime overlay excludes editors and code-like regions", () => {
  const overlay = createRuntimeOverlay(dictionary);
  assert.match(overlay, /contenteditable/);
  assert.match(overlay, /monaco-editor/);
  assert.match(overlay, /blockedAttributeSelector/);
  assert.match(overlay, /isAttributeBlocked/);
  assert.match(overlay, /Node\.TEXT_NODE/);
});

test("dictionary hit count is deterministic", () => {
  assert.deepEqual(
    countBundleDictionaryHits("Settings only", dictionary),
    { hits: 1, total: 2 },
  );
});

test("dictionary translation supports exact and narrowly scoped dynamic text", () => {
  assert.equal(translateDictionaryValue("  Settings  ", dictionary), "  设置  ");
  assert.equal(
    translateDictionaryValue("Quota refreshes in 2 hours, 3 minutes.", dictionary),
    "额度将在 2 小时 3 分钟后恢复。",
  );
  assert.equal(translateDictionaryValue("Quota refreshes tomorrow.", dictionary), null);
});

test("Antigravity 2.5.0 settings and usage strings are covered", async () => {
  const current = await loadDomTranslations();
  const visibleStrings = [
    "Models & Usage",
    "Manage your model quota and credits.",
    "Plan",
    "You can upgrade to a Google AI Ultra plan to receive higher rate limits.",
    "Model Credits",
    "Enable AI Credit Overages",
    "When toggled on, Antigravity will use your AI credits to fulfill model requests once you're out of model quota. Antigravity will always use your model quota first before using AI credits.",
    "Gemini Models",
    "Weekly Limit",
    "You have used some of your weekly limit, it will fully refresh in 2 days, 23 hours.",
    "Five Hour Limit",
    "Claude and GPT models",
    "Configure agent execution, queued message delivery, and permissions.",
    "Execution",
    "Queued Messages",
    "Configure when follow-up messages are sent.",
    "Keyboard shortcuts",
    "Queue After Turn",
    "Send Immediately",
    "Verbose Agent Chat",
    "Display and preserve intermediate thinking steps.",
    "Conversation Width",
    "Configure the maximum width of the conversation panel.",
    "Default",
    "Open IDE",
    "Message input",
    "Ask anything, @ to mention, / for actions",
    "Add context",
    "Select model, current: Gemini 3.6 Flash (High)",
    "Gemini 3.6 Flash (High)",
    "Record voice memo",
    "Send message",
    "Select Agent",
    "Main Agent",
    "Display Options",
    "Project options",
    "New Conversation in Project",
    "Typeahead menu",
    "Always Ask",
    "File Permissions",
    "Network Permissions",
    "Terminal & Tooling Permissions",
    "Dark",
    "Light",
    "System",
    "Requires manual review for all terminal commands and file accesses outside of the working folders.",
    "Full machine",
    "All terminal commands require review. The agent can read or write to any file in the machine.",
    "Turbo mode",
    "Disables all safety barriers for maximal iteration velocity.",
    "Manually customize individual settings.",
    "Outside of folders file access policy",
    "Configures how the agent tries to access files outside of its working folders.",
    "Require Review",
    "Build With Google Plugins",
    "Customize",
    "Block all browser JavaScript execution.",
    "Prompt for approval before running browser scripts.",
    "Allow full browser script execution without prompting.",
  ];

  for (const source of visibleStrings) {
    const translated = translateDictionaryValue(source, current);
    assert.ok(translated, `missing screenshot translation: ${source}`);
    assert.match(translated, /[\u3400-\u9fff]/u, `translation is not Chinese: ${source}`);
  }
});

test("Antigravity 2.6.0 settings and plugin strings are covered", async () => {
  const current = await loadDomTranslations();
  const visibleStrings = [
    "Agent Terminal Customizations",
    "Allow sandboxed commands to make network requests.",
    "Autonomous",
    "Autonomous mode active: the agent works independently, and does not ask questions or request new permissions.",
    "Discover helpful skills & plugins",
    "Every terminal command requires approval.",
    "Hooks",
    "Keep the app accessible from the menu bar and running in the background when all windows are closed.",
    "Let the agent access past conversations to inform its responses.",
    "Open files in the background if the agent creates or edits them",
    "Open the agent panel on window reload",
    "Plugin details",
    "Predict the location of your next edit and navigate you there with a tab keypress.",
    "Terminal Setup Script",
    "The agent always asks for confirmation before executing terminal commands (except those in the Allow list).",
    "The agent always asks for review.",
    "The agent asks for permission before executing commands matched by a deny list entry.",
    "The agent auto-executes commands matched by an allow list entry.",
    "Use my conversation history to tell me which skills and plugins would be helpful for me.",
    "View Usage",
  ];

  for (const source of visibleStrings) {
    const translated = current.exact[source];
    assert.ok(translated, `missing translation for: ${source}`);
    assert.match(translated, /[\u3400-\u9fff]/u, `translation is not Chinese: ${source}`);
  }
});

test("Antigravity 2.15.0 agent permission confirmation dialog strings and templates are covered", async () => {
  const current = await loadDomTranslations();
  const exactStrings = [
    "Allow reading this URL?",
    "Allow executing actions on this URL?",
    "Allow read access to this path?",
    "Allow write access to this path?",
    "Allow running this command?",
    "Allow running this command outside the sandbox?",
    "Allow using this MCP tool?",
    "Allow a one-time administrator (UAC) elevation?",
    "Allow access to this resource?",
    "Save rule to always allow reading this URL?",
    "Save rule to always allow executing actions on this URL?",
    "Save rule to always allow read access to this path?",
    "Save rule to always allow write access to this path?",
    "Save rule to always allow running this command?",
    "Save rule to always allow running this command outside the sandbox?",
    "Save rule to always allow using this MCP tool?",
    "Save rule to always allow a one-time administrator (UAC) elevation?",
    "Save rule to always allow access to this resource?",
    "Yes, allow",
    "Yes, allow this time",
    "Yes, and always allow",
    "Yes, and always allow in this conversation",
    "Yes, and always allow in this project",
    "Yes, and always allow in this workspace",
    "Yes, and always allow when not in a project",
    "Yes, save rule",
    "Yes, save rule globally",
    "Yes, save rule in this conversation",
    "Yes, save rule in this project",
    "Yes, save rule in this workspace",
    "Yes, save rule when not in a project",
    "No (tell the agent what to do instead)",
    "(tell the agent what to do instead)",
    "Skip",
    "Skip All",
    "Always Allow",
    "Allow Once",
    "Allow once",
    "Deny",
    "Edit permission target",
    "Confirm the command is safe to run outside of the sandbox with full network and disk access.",
    "Requesting a one-time administrator (UAC) elevation",
    "Requires manual confirmation.",
    "Agent needs permission to execute JavaScript",
  ];

  for (const source of exactStrings) {
    const translated = translateDictionaryValue(source, current);
    assert.ok(translated, `missing exact permission translation: ${source}`);
    assert.match(translated, /[\u3400-\u9fff]/u, `translation is not Chinese: ${source}`);
  }

  const dynamicTemplates = [
    {
      source: "Allow custom tool execution on target?",
      expected: "允许 custom tool execution on target？",
    },
    {
      source: "Save rule to always allow custom tool execution on target?",
      expected: "保存规则以始终允许 custom tool execution on target？",
    },
    {
      source: "Yes, and always allow 'github.com' in this conversation",
      expected: "是，并始终在当前对话中允许“github.com”",
    },
    {
      source: "Yes, and always allow 'C:/dev/project' when not in a project",
      expected: "是，并在非项目环境下始终允许“C:/dev/project”",
    },
    {
      source: "Yes, and always allow 'npm test' in this project",
      expected: "是，并在此项目中始终允许“npm test”",
    },
    {
      source: "Yes, and always allow 'my-tool' in this workspace",
      expected: "是，并在此工作区中始终允许“my-tool”",
    },
    {
      source: "Yes, and always allow 'api.example.com'",
      expected: "是，并始终允许“api.example.com”",
    },
    {
      source: "Yes, save rule for 'github.com' in this conversation",
      expected: "是，并在当前对话中为“github.com”保存规则",
    },
    {
      source: "Yes, save rule for 'C:/dev/project' when not in a project",
      expected: "是，并在非项目环境下为“C:/dev/project”保存规则",
    },
    {
      source: "Yes, save rule for 'npm test' in this project",
      expected: "是，并在此项目中为“npm test”保存规则",
    },
    {
      source: "Yes, save rule for 'my-tool' in this workspace",
      expected: "是，并在此工作区中为“my-tool”保存规则",
    },
    {
      source: "Yes, save rule for 'api.example.com' globally",
      expected: "是，并全局为“api.example.com”保存规则",
    },
    {
      source: "Yes, save rule for 'api.example.com'",
      expected: "是，并为“api.example.com”保存规则",
    },
    {
      source: "Requesting permission to read C:/app/src",
      expected: "正在请求权限以read C:/app/src",
    },
    {
      source: "Conflicts with your configured Ask permission: read_file(/etc/hosts)",
      expected: "与已配置的“询问”权限冲突：read_file(/etc/hosts)",
    },
    {
      source: "Requires manual confirmation: command(rm -rf /)",
      expected: "需要手动确认：command(rm -rf /)",
    },
    {
      source: "Agent needs permission to execute JavaScript on docs.anthropic.com",
      expected: "智能体需要权限以在 docs.anthropic.com 上执行 JavaScript",
    },
    {
      source: "Agent needs permission to act on example.com",
      expected: "智能体需要权限以在 example.com 上执行操作",
    },
  ];

  for (const { source, expected } of dynamicTemplates) {
    const translated = translateDictionaryValue(source, current);
    assert.equal(
      translated,
      expected,
      `dynamic pattern translation mismatch for: ${source}`,
    );
  }
});
