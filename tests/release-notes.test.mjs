import assert from "node:assert/strict";
import test from "node:test";
import { buildReleaseCompatibilityNotes } from "../src/lib/release-notes.mjs";

test("release notes list versions once and report multiple verified builds", () => {
  const notes = buildReleaseCompatibilityNotes({
    targets: [
      {
        appVersion: "2.4.3",
        platform: "win32",
        arch: "x64",
        appAsarSha256: "A".repeat(64),
      },
      {
        appVersion: "2.4.3",
        platform: "win32",
        arch: "x64",
        appAsarSha256: "B".repeat(64),
      },
      {
        appVersion: "2.3.1",
        platform: "win32",
        arch: "x64",
        appAsarSha256: "C".repeat(64),
      },
    ],
  });

  assert.match(notes, /`2\.4\.3` \/ Windows x64，2 个已验证构建/);
  assert.equal(notes.match(/`2\.4\.3`/g)?.length, 1);
  assert.ok(notes.indexOf("2.4.3") < notes.indexOf("2.3.1"));
  assert.match(notes, /通用 portable ZIP/);
});
