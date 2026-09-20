import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  atomicReplaceFile,
  patchCustomSchemeSource,
} from "../src/lib/patcher.mjs";
import { sha256Buffer } from "../src/lib/hash.mjs";

const fixture = `"use strict";
function registerCustomSchemes() {
    protocol.registerSchemesAsPrivileged([
        {
            scheme: 'plugin',
            privileges: {
                standard: true,
            },
        },
    ]);
}
function registerCustomSchemeHandlers() {
    protocol.handle('plugin', async () => {
        return new Response(null, { status: 200 });
    });
}
`;

test("patchCustomSchemeSource adds a scoped scheme and redirect", () => {
  const patched = patchCustomSchemeSource(fixture);
  assert.match(patched, /scheme: 'agy-zhcn'/);
  assert.match(patched, /agy-zhcn:\/\/bundle\/main\.js/);
  assert.match(patched, /scheme: 'plugin'/);
});

test("patchCustomSchemeSource refuses a second patch", () => {
  const patched = patchCustomSchemeSource(fixture);
  assert.throws(
    () => patchCustomSchemeSource(patched),
    /已包含本项目补丁/,
  );
});

test("patchCustomSchemeSource refuses unknown source layout", () => {
  assert.throws(
    () => patchCustomSchemeSource("function changed() {}"),
    /补丁锚点不唯一/,
  );
});

test("atomicReplaceFile can roll back to the verified original", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agy-zhcn-test-"));
  const currentPath = path.join(tempRoot, "current.bin");
  const replacementPath = path.join(tempRoot, "replacement.bin");
  const original = Buffer.from("verified-original");
  const replacement = Buffer.from("verified-replacement");

  try {
    await writeFile(currentPath, original);
    await writeFile(replacementPath, replacement);
    const operation = await atomicReplaceFile({
      currentPath,
      replacementPath,
      currentExpectedHash: sha256Buffer(original),
      replacementExpectedHash: sha256Buffer(replacement),
    });
    assert.deepEqual(await readFile(currentPath), replacement);

    await operation.rollback();
    assert.deepEqual(await readFile(currentPath), original);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("atomicReplaceFile refuses an unexpected current file", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agy-zhcn-test-"));
  const currentPath = path.join(tempRoot, "current.bin");
  const replacementPath = path.join(tempRoot, "replacement.bin");

  try {
    await writeFile(currentPath, "unexpected");
    await writeFile(replacementPath, "replacement");
    await assert.rejects(
      () =>
        atomicReplaceFile({
          currentPath,
          replacementPath,
          currentExpectedHash: sha256Buffer(Buffer.from("expected")),
          replacementExpectedHash: sha256Buffer(Buffer.from("replacement")),
        }),
      /当前哈希不一致/,
    );
    assert.equal(await readFile(currentPath, "utf8"), "unexpected");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
