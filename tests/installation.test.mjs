import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyLocalizedBundleInstall,
  findCompatibilityTarget,
  getVersionTargets,
  loadCompatibilityManifest,
} from "../src/lib/installation.mjs";

test("localized UI install only replaces a hash verified by prior state", () => {
  const expectedHash = "NEW";
  const replaceableHash = "OLD";

  assert.equal(
    classifyLocalizedBundleInstall({
      existingHash: null,
      expectedHash,
      replaceableHash,
    }),
    "create",
  );
  assert.equal(
    classifyLocalizedBundleInstall({
      existingHash: expectedHash,
      expectedHash,
      replaceableHash,
    }),
    "reuse",
  );
  assert.equal(
    classifyLocalizedBundleInstall({
      existingHash: replaceableHash,
      expectedHash,
      replaceableHash,
    }),
    "replace",
  );
  assert.equal(
    classifyLocalizedBundleInstall({
      existingHash: "UNKNOWN",
      expectedHash,
      replaceableHash,
    }),
    "reject",
  );
});

const firstBuild = {
  platform: "win32",
  arch: "x64",
  appVersion: "2.4.3",
  appAsarSha256: "A".repeat(64),
  customSchemePath: "dist/customScheme.js",
  customSchemeSha256: "C".repeat(64),
};
const secondBuild = {
  ...firstBuild,
  appAsarSha256: "B".repeat(64),
  customSchemeSha256: "D".repeat(64),
};

test("compatibility matching supports multiple builds of one app version", () => {
  const versionTargets = getVersionTargets([firstBuild, secondBuild], {
    platform: "win32",
    arch: "x64",
    appVersion: "2.4.3",
  });

  assert.equal(versionTargets.length, 2);
  assert.equal(
    findCompatibilityTarget(versionTargets, {
      appAsarSha256: secondBuild.appAsarSha256,
      customSchemes: {
        "dist/customScheme.js": { sha256: secondBuild.customSchemeSha256 },
      },
    }),
    secondBuild,
  );
});

test("compatibility matching still rejects an unknown build fingerprint", () => {
  const versionTargets = getVersionTargets([firstBuild, secondBuild], {
    platform: "win32",
    arch: "x64",
    appVersion: "2.4.3",
  });

  assert.equal(
    findCompatibilityTarget(versionTargets, {
      appAsarSha256: "E".repeat(64),
      customSchemes: {
        "dist/customScheme.js": { sha256: firstBuild.customSchemeSha256 },
      },
    }),
    null,
  );
});

test("compatibility matching ignores an unavailable entry from another build", () => {
  const alternatePathBuild = {
    ...secondBuild,
    customSchemePath: "dist/newCustomScheme.js",
  };
  const versionTargets = [firstBuild, alternatePathBuild];

  assert.equal(
    findCompatibilityTarget(versionTargets, {
      appAsarSha256: alternatePathBuild.appAsarSha256,
      customSchemes: {
        "dist/customScheme.js": null,
        "dist/newCustomScheme.js": {
          sha256: alternatePathBuild.customSchemeSha256,
        },
      },
    }),
    alternatePathBuild,
  );
});

test("split compatibility configuration loads every supported version", async () => {
  const manifest = await loadCompatibilityManifest();
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(
    [...new Set(manifest.targets.map((target) => target.appVersion))].sort(),
    [
      "2.10.0",
      "2.11.0",
      "2.12.0",
      "2.12.2",
      "2.13.0",
      "2.14.0",
      "2.15.0",
      "2.15.1",
      "2.2.1",
      "2.3.0",
      "2.3.1",
      "2.4.3",
      "2.5.0",
      "2.6.0",
      "2.7.1",
      "2.8.1",
      "2.9.1",
    ],
  );
});

test("split compatibility configuration rejects a mismatched version folder", async () => {
  const rootDirectory = await mkdtemp(
    path.join(os.tmpdir(), "agy-compatibility-test-"),
  );
  const versionDirectory = path.join(rootDirectory, "2.5.0");
  try {
    await mkdir(versionDirectory);
    await writeFile(
      path.join(versionDirectory, "win32-x64.json"),
      JSON.stringify({
        schemaVersion: 1,
        appVersion: "2.5.1",
        targets: [{ appVersion: "2.5.1" }],
      }),
    );
    await assert.rejects(
      () => loadCompatibilityManifest({ rootDirectory }),
      /兼容性配置格式无效/,
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});
