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
