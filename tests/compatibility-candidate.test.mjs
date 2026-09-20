import assert from "node:assert/strict";
import test from "node:test";
import { buildCompatibilityCandidate } from "../src/lib/compatibility-candidate.mjs";
import { sha256Buffer } from "../src/lib/hash.mjs";

test("compatibility collection creates an explicitly unverified candidate", () => {
  const customSchemeBuffer = Buffer.from("custom-scheme");
  const uiBundle = Buffer.from("runtime-ui");
  const candidate = buildCompatibilityCandidate({
    appVersion: "2.5.0",
    appAsarSha256: "A".repeat(64),
    customSchemePath: "dist/customScheme.js",
    customSchemeBuffer,
    uiBundle,
    platform: "win32",
    arch: "x64",
    collectedAt: "2026-07-31T00:00:00.000Z",
  });

  assert.equal(candidate.appVersion, "2.5.0");
  assert.equal(candidate.customSchemeSha256, sha256Buffer(customSchemeBuffer));
  assert.equal(candidate.uiBundleSha256, sha256Buffer(uiBundle));
  assert.equal(candidate.uiBundleSize, uiBundle.length);
  assert.match(candidate.notes, /UNVERIFIED/);
});

test("compatibility collection rejects malformed versions", () => {
  assert.throws(
    () =>
      buildCompatibilityCandidate({
        appVersion: "unknown",
        appAsarSha256: "A".repeat(64),
        customSchemePath: "dist/customScheme.js",
        customSchemeBuffer: Buffer.from("custom"),
        uiBundle: Buffer.from("ui"),
      }),
    /无法识别客户端版本/,
  );
});
