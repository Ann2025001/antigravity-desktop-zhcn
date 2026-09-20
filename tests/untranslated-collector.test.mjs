import test from "node:test";
import assert from "node:assert/strict";
import {
  isPotentialEnglishUi,
  classifyTextCoverage,
  UntranslatedCollector,
} from "../src/lib/untranslated-collector.mjs";
import { loadDomTranslations } from "../src/lib/translator.mjs";

test("untranslated collector identifies valid UI English buttons and labels", () => {
  assert.equal(
    isPotentialEnglishUi("Advanced Options", { tagName: "BUTTON" }),
    true,
  );
  assert.equal(
    isPotentialEnglishUi("Enable Experimental Feature", {
      tagName: "LABEL",
      role: "checkbox",
    }),
    true,
  );
  assert.equal(
    isPotentialEnglishUi("Search settings", {
      attributeName: "placeholder",
    }),
    true,
  );
  assert.equal(
    isPotentialEnglishUi("Close modal", {
      attributeName: "aria-label",
    }),
    true,
  );
});

test("untranslated collector rejects Chinese UI strings", () => {
  assert.equal(isPotentialEnglishUi("设置", { tagName: "BUTTON" }), false);
  assert.equal(isPotentialEnglishUi("保存修改", { tagName: "BUTTON" }), false);
  assert.equal(
    isPotentialEnglishUi("允许 custom tool execution", { tagName: "BUTTON" }),
    false,
  );
});

test("untranslated collector rejects URLs, domains, and web addresses", () => {
  assert.equal(
    isPotentialEnglishUi("https://github.com/foo/bar", { tagName: "SPAN" }),
    false,
  );
  assert.equal(
    isPotentialEnglishUi("http://127.0.0.1:8080", { tagName: "SPAN" }),
    false,
  );
  assert.equal(
    isPotentialEnglishUi("file:///C:/Users/app.asar", { tagName: "SPAN" }),
    false,
  );
  assert.equal(
    isPotentialEnglishUi("agy://custom/path", { tagName: "SPAN" }),
    false,
  );
  assert.equal(isPotentialEnglishUi("github.com", { tagName: "SPAN" }), false);
  assert.equal(isPotentialEnglishUi("localhost:3000", { tagName: "SPAN" }), false);
});

test("untranslated collector rejects file paths and technical filenames", () => {
  assert.equal(
    isPotentialEnglishUi("C:\\Users\\Admin\\AppData\\Roaming", {
      tagName: "SPAN",
    }),
    false,
  );
  assert.equal(
    isPotentialEnglishUi("C:/Program Files/Antigravity", { tagName: "SPAN" }),
    false,
  );
  assert.equal(
    isPotentialEnglishUi("/usr/local/bin/node", { tagName: "SPAN" }),
    false,
  );
  assert.equal(
    isPotentialEnglishUi("../dist/customScheme.js", { tagName: "SPAN" }),
    false,
  );
  assert.equal(
    isPotentialEnglishUi("app.asar", { tagName: "SPAN" }),
    false,
  );
  assert.equal(
    isPotentialEnglishUi("config.json", { tagName: "SPAN" }),
    false,
  );
});

test("untranslated collector rejects terminal and shell commands", () => {
  assert.equal(
    isPotentialEnglishUi("npm run test", { tagName: "SPAN" }),
    false,
  );
  assert.equal(
    isPotentialEnglishUi("git commit -m 'fix: bug'", { tagName: "SPAN" }),
    false,
  );
  assert.equal(
    isPotentialEnglishUi("powershell -ExecutionPolicy Bypass", {
      tagName: "SPAN",
    }),
    false,
  );
  assert.equal(
    isPotentialEnglishUi("node src/cli.mjs --yes", { tagName: "SPAN" }),
    false,
  );
});

test("untranslated collector rejects code snippets and JSON", () => {
  assert.equal(
    isPotentialEnglishUi("const x = () => { return 1; }", { tagName: "SPAN" }),
    false,
  );
  assert.equal(
    isPotentialEnglishUi("{\"key\": \"value\"}", { tagName: "SPAN" }),
    false,
  );
  assert.equal(
    isPotentialEnglishUi("console.log('debug message')", { tagName: "SPAN" }),
    false,
  );
});

test("untranslated collector rejects tokens, API keys, hashes, and UUIDs", () => {
  assert.equal(
    isPotentialEnglishUi("sk-proj-1234567890abcdef1234567890abcdef", {
      tagName: "SPAN",
    }),
    false,
  );
  assert.equal(
    isPotentialEnglishUi("AIzaSyD1234567890abcdefghijklmnopqrstuv", {
      tagName: "SPAN",
    }),
    false,
  );
  assert.equal(
    isPotentialEnglishUi(
      "4784d00f2d812cc3abae31f37381b80b24656fff4784d00f2d812cc3abae31f3",
      { tagName: "SPAN" },
    ),
    false,
  );
  assert.equal(
    isPotentialEnglishUi("c2d3e4f5-1234-5678-9abc-def012345678", {
      tagName: "SPAN",
    }),
    false,
  );
});

test("untranslated collector rejects user inputs, model outputs, and chat messages", () => {
  assert.equal(
    isPotentialEnglishUi("How do I write a quicksort algorithm?", {
      tagName: "DIV",
      isUserInput: true,
    }),
    false,
  );
  assert.equal(
    isPotentialEnglishUi("Here is the explanation of quicksort in Python...", {
      tagName: "DIV",
      isModelOutput: true,
    }),
    false,
  );
  assert.equal(
    isPotentialEnglishUi("Some chat message from assistant", {
      tagName: "DIV",
      closestSelectors: ["[data-testid='chat-message-bubble']"],
    }),
    false,
  );
  assert.equal(
    isPotentialEnglishUi("Model thinking process...", {
      tagName: "DIV",
      closestSelectors: ["[data-testid='thinking-view']"],
    }),
    false,
  );
  assert.equal(
    isPotentialEnglishUi("Editor code contents", {
      tagName: "DIV",
      closestSelectors: [".monaco-editor"],
    }),
    false,
  );
});

test("untranslated collector correctly distinguishes exact and pattern covered strings", async () => {
  const dictionary = await loadDomTranslations();

  const exactCheck = classifyTextCoverage("General", dictionary);
  assert.equal(exactCheck.status, "exact-covered");
  assert.equal(exactCheck.translated, "通用");

  const patternCheck = classifyTextCoverage(
    "Yes, and always allow 'my-custom-tool' in this conversation",
    dictionary,
  );
  assert.equal(patternCheck.status, "pattern-covered");
  assert.equal(
    patternCheck.translated,
    "是，并始终在当前对话中允许“my-custom-tool”",
  );

  const unknownCheck = classifyTextCoverage(
    "Unseen Feature Button Text",
    dictionary,
  );
  assert.equal(unknownCheck.status, "untranslated");
  assert.equal(unknownCheck.translated, null);
});

test("untranslated collector aggregates candidates and outputs structured reports", async () => {
  const dictionary = await loadDomTranslations();
  const collector = new UntranslatedCollector({
    dictionary,
    appVersion: "2.15.0",
  });

  // Record already translated string -> status is exact-covered
  collector.record({
    text: "General",
    tagName: "BUTTON",
    role: "tab",
  });

  // Record untranslated strings
  collector.record({
    text: "Advanced Experimental Studio",
    tagName: "BUTTON",
    role: "button",
  });
  collector.record({
    text: "Advanced Experimental Studio",
    tagName: "BUTTON",
    role: "button",
  });
  collector.record({
    text: "Export Workspace Bundle",
    tagName: "BUTTON",
    role: "menuitem",
  });

  // Negative cases must be dropped
  assert.equal(
    collector.record({
      text: "https://github.com",
      tagName: "SPAN",
    }),
    false,
  );
  assert.equal(
    collector.record({
      text: "User question about code",
      tagName: "DIV",
      isUserInput: true,
    }),
    false,
  );

  const untranslated = collector.getCandidates({ status: "untranslated" });
  assert.equal(untranslated.length, 2);
  assert.equal(untranslated[0].text, "Advanced Experimental Studio");
  assert.equal(untranslated[0].count, 2);
  assert.equal(untranslated[1].text, "Export Workspace Bundle");
  assert.equal(untranslated[1].count, 1);

  const jsonReport = collector.generateJsonReport();
  assert.equal(jsonReport.totalCandidates, 2);
  assert.equal(jsonReport.appVersion, "2.15.0");

  const mdReport = collector.generateMarkdownReport();
  assert.match(mdReport, /# Antigravity 未翻译英文 UI 采集报告 \(2\.15\.0\)/);
  assert.match(mdReport, /Advanced Experimental Studio/);
  assert.match(mdReport, /Export Workspace Bundle/);
});

test("dynamic popup / portal UI elements are collected while project name is preserved", async () => {
  // Test dynamic menu item inside popover portal
  const isMenuUi = isPotentialEnglishUi("Create New Branch", {
    tagName: "DIV",
    role: "menuitem",
    closestSelectors: ["[role='menu']", "[data-radix-popper-content-wrapper]"],
  });
  assert.equal(isMenuUi, true);

  // Project name with custom identifier should not be matched by exact or patterns
  const dictionary = await loadDomTranslations();
  const projectNameCoverage = classifyTextCoverage(
    "wonderful-davinci",
    dictionary,
  );
  assert.equal(projectNameCoverage.status, "untranslated");
  assert.equal(projectNameCoverage.translated, null);
});

test("closed loop: New Project and Quick Start are detected when untranslated and disappear when exact covered", () => {
  // 1. Mock dictionary without New Project and Quick Start
  const partialDict = {
    exact: {},
    patterns: [
      {
        source: "^New\\s+(.+)$",
        target: "新建 $1",
        flags: "u",
      },
    ],
  };

  const collector1 = new UntranslatedCollector({
    dictionary: partialDict,
    appVersion: "2.15.0",
  });

  collector1.record({
    text: "New Project",
    tagName: "DIV",
    role: "menuitem",
    closestSelectors: ["[role='menu']"],
  });
  collector1.record({
    text: "Quick Start",
    tagName: "DIV",
    role: "menuitem",
    closestSelectors: ["[role='menu']"],
  });

  const candidatesBefore = collector1.getCandidates({
    status: "all-untranslated",
  });
  assert.equal(candidatesBefore.length, 2);
  assert.equal(candidatesBefore[0].text, "New Project");
  assert.equal(candidatesBefore[0].status, "partial-untranslated");
  assert.equal(candidatesBefore[0].translated, "新建 Project");
  assert.equal(candidatesBefore[1].text, "Quick Start");
  assert.equal(candidatesBefore[1].status, "untranslated");

  // 2. Mock dictionary with exact translations added
  const fullDict = {
    exact: {
      "New Project": "新建项目",
      "Quick Start": "快速开始",
    },
    patterns: partialDict.patterns,
  };

  const collector2 = new UntranslatedCollector({
    dictionary: fullDict,
    appVersion: "2.15.0",
  });

  collector2.record({
    text: "New Project",
    tagName: "DIV",
    role: "menuitem",
    closestSelectors: ["[role='menu']"],
  });
  collector2.record({
    text: "Quick Start",
    tagName: "DIV",
    role: "menuitem",
    closestSelectors: ["[role='menu']"],
  });

  const candidatesAfter = collector2.getCandidates({
    status: "all-untranslated",
  });
  assert.equal(candidatesAfter.length, 0);
});
