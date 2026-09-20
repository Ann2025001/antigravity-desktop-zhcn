import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadEffectiveCompatibilityManifest,
  mergeCompatibilityManifests,
  verifySignedCompatibilityPayload,
} from "../src/lib/remote-compatibility.mjs";

const now = new Date("2026-08-09T00:00:00.000Z");
const manifestUrl =
  "https://raw.githubusercontent.com/chenmo00000/antigravity-desktop-zhcn/main/config/remote/compatibility-manifest.json";

function createSigner() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privateKey,
    trust: {
      schemaVersion: 1,
      algorithm: "Ed25519",
      manifestUrl,
      publicKeySpkiBase64: publicKey
        .export({ type: "spki", format: "der" })
        .toString("base64"),
      cacheTtlHours: 6,
    },
  };
}

function createTarget(version = "2.6.0", hashCharacter = "A") {
  return {
    platform: "win32",
    arch: "x64",
    appVersion: version,
    packageVersion: version,
    appAsarSha256: hashCharacter.repeat(64),
    customSchemePath: "dist/customScheme.js",
    customSchemeSha256: "B".repeat(64),
    uiBundleSha256: "C".repeat(64),
    uiBundleSize: 1024,
  };
}

function createSignedPayload(privateKey, { sequence = 1, targets } = {}) {
  const document = {
    schemaVersion: 1,
    sequence,
    issuedAt: "2026-08-08T00:00:00.000Z",
    expiresAt: "2026-12-31T00:00:00.000Z",
    targets: targets ?? [createTarget()],
  };
  const payload = Buffer.from(`${JSON.stringify(document, null, 2)}\n`);
  const signature = Buffer.from(
    `${sign(null, payload, privateKey).toString("base64")}\n`,
  );
  return { document, payload, signature };
}

test("signed remote compatibility accepts only an intact Ed25519 payload", () => {
  const { privateKey, trust } = createSigner();
  const signed = createSignedPayload(privateKey);
  const verified = verifySignedCompatibilityPayload({
    ...signed,
    trust,
    now,
  });
  assert.equal(verified.sequence, 1);

  const tampered = Buffer.from(signed.payload);
  tampered[tampered.length - 2] ^= 1;
  assert.throws(
    () =>
      verifySignedCompatibilityPayload({
        payload: tampered,
        signature: signed.signature,
        trust,
        now,
      }),
    /签名验证失败/,
  );
});

test("signed remote compatibility rejects expired documents", () => {
  const { privateKey, trust } = createSigner();
  const signed = createSignedPayload(privateKey);
  assert.throws(
    () =>
      verifySignedCompatibilityPayload({
        ...signed,
        trust,
        now: new Date("2027-01-01T00:00:00.000Z"),
      }),
    /已经过期/,
  );
});

test("remote targets may extend but never conflict with built-in targets", () => {
  const localTarget = createTarget();
  const localManifest = { schemaVersion: 1, targets: [localTarget] };
  const extended = mergeCompatibilityManifests(localManifest, {
    targets: [localTarget, createTarget("2.7.0", "D")],
  });
  assert.equal(extended.targets.length, 2);

  assert.throws(
    () =>
      mergeCompatibilityManifests(localManifest, {
        targets: [{ ...localTarget, uiBundleSha256: "E".repeat(64) }],
      }),
    /与内置目标冲突/,
  );
});

test("verified network data is cached and can be reused offline", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agy-remote-test-"));
  const { privateKey, trust } = createSigner();
  const localTarget = createTarget();
  const localManifest = { schemaVersion: 1, targets: [localTarget] };
  const signed = createSignedPayload(privateKey, {
    sequence: 2,
    targets: [localTarget, createTarget("2.7.0", "D")],
  });
  const fetchBuffer = async (url) =>
    url.endsWith(".sig") ? signed.signature : signed.payload;

  try {
    const online = await loadEffectiveCompatibilityManifest({
      localManifest,
      trust,
      stateRoot: tempRoot,
      now,
      fetchBuffer,
    });
    assert.equal(online.remote.status, "verified-network");
    assert.equal(online.remote.sequence, 2);
    assert.equal(online.targets.length, 2);

    const offline = await loadEffectiveCompatibilityManifest({
      localManifest,
      trust,
      stateRoot: tempRoot,
      now: new Date(now.getTime() + 60_000),
      allowNetwork: false,
    });
    assert.equal(offline.remote.status, "verified-cache");
    assert.equal(offline.remote.sequence, 2);
    assert.equal(offline.targets.length, 2);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("invalid remote data fails closed to the built-in manifest", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agy-remote-test-"));
  const { trust } = createSigner();
  const localManifest = { schemaVersion: 1, targets: [createTarget()] };
  try {
    const result = await loadEffectiveCompatibilityManifest({
      localManifest,
      trust,
      stateRoot: tempRoot,
      now,
      fetchBuffer: async (url) =>
        url.endsWith(".sig") ? Buffer.from("invalid") : Buffer.from("{}"),
    });
    assert.equal(result.remote.status, "local-fallback");
    assert.equal(result.targets.length, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("a lower remote sequence cannot replace a newer verified cache", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agy-remote-test-"));
  const { privateKey, trust } = createSigner();
  const localManifest = { schemaVersion: 1, targets: [createTarget()] };
  const newer = createSignedPayload(privateKey, {
    sequence: 3,
    targets: [createTarget(), createTarget("2.8.0", "E")],
  });
  const older = createSignedPayload(privateKey, {
    sequence: 2,
    targets: [createTarget(), createTarget("2.7.0", "D")],
  });
  let response = newer;
  const fetchBuffer = async (url) =>
    url.endsWith(".sig") ? response.signature : response.payload;

  try {
    const initial = await loadEffectiveCompatibilityManifest({
      localManifest,
      trust,
      stateRoot: tempRoot,
      now,
      fetchBuffer,
    });
    assert.equal(initial.remote.sequence, 3);

    response = older;
    const afterRollbackAttempt = await loadEffectiveCompatibilityManifest({
      localManifest,
      trust,
      stateRoot: tempRoot,
      now: new Date(now.getTime() + 7 * 60 * 60_000),
      fetchBuffer,
    });
    assert.equal(afterRollbackAttempt.remote.status, "verified-cache");
    assert.equal(afterRollbackAttempt.remote.sequence, 3);
    assert.match(afterRollbackAttempt.remote.warning, /序号低于/);
    assert.equal(
      afterRollbackAttempt.targets.some((target) => target.appVersion === "2.8.0"),
      true,
    );
    assert.equal(
      afterRollbackAttempt.targets.some((target) => target.appVersion === "2.7.0"),
      false,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
