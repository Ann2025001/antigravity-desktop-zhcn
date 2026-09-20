import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { areSamePaths, resolveInstallRoot } from "../src/lib/paths.mjs";

test("Windows install path comparison ignores case and redundant segments", () => {
  assert.equal(
    areSamePaths(
      "C:\\Users\\TestUser\\AppData\\Local\\Programs\\antigravity",
      "c:\\users\\testuser\\appdata\\local\\programs\\antigravity\\.",
      "win32",
    ),
    true,
  );
  assert.equal(
    areSamePaths("C:\\Apps\\Antigravity", "C:\\Apps\\AntigravityIDE", "win32"),
    false,
  );
});

async function createDesktopInstall(installRoot) {
  await mkdir(path.join(installRoot, "resources"), { recursive: true });
  await Promise.all([
    writeFile(path.join(installRoot, "Antigravity.exe"), "desktop"),
    writeFile(path.join(installRoot, "resources", "app.asar"), "asar"),
  ]);
}

test("AGY_INSTALL_PATH has the highest priority", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agy-paths-test-"));
  const installRoot = path.join(tempRoot, "custom");
  let queriedWindows = false;

  try {
    await createDesktopInstall(installRoot);
    const resolved = await resolveInstallRoot({
      env: {
        AGY_INSTALL_PATH: installRoot,
        LOCALAPPDATA: path.join(tempRoot, "local"),
      },
      platform: "win32",
      findWindowsCandidates: async () => {
        queriedWindows = true;
        return [];
      },
    });

    assert.equal(resolved.installRoot, installRoot);
    assert.equal(resolved.source, "environment");
    assert.equal(queriedWindows, false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("a running Desktop process wins over registry and default paths", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agy-paths-test-"));
  const processRoot = path.join(tempRoot, "running");
  const registryRoot = path.join(tempRoot, "registered");
  const defaultRoot = path.join(tempRoot, "local", "Programs", "Antigravity");

  try {
    await Promise.all([
      createDesktopInstall(processRoot),
      createDesktopInstall(registryRoot),
      createDesktopInstall(defaultRoot),
    ]);
    const resolved = await resolveInstallRoot({
      env: { LOCALAPPDATA: path.join(tempRoot, "local") },
      platform: "win32",
      findWindowsCandidates: async () => [
        {
          source: "registry",
          value: `"${path.join(registryRoot, "Antigravity.exe")}",0`,
        },
        {
          source: "process",
          value: path.join(processRoot, "Antigravity.exe"),
        },
      ],
    });

    assert.equal(resolved.installRoot, processRoot);
    assert.equal(resolved.source, "process");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("registry DisplayIcon paths are normalized to the install root", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agy-paths-test-"));
  const installRoot = path.join(tempRoot, "registered");

  try {
    await createDesktopInstall(installRoot);
    const resolved = await resolveInstallRoot({
      env: {},
      platform: "win32",
      findWindowsCandidates: async () => [
        {
          source: "registry",
          value: `"${path.join(installRoot, "Antigravity.exe")}",0`,
        },
      ],
    });

    assert.equal(resolved.installRoot, installRoot);
    assert.equal(resolved.source, "registry");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("Antigravity IDE candidates are not treated as Desktop", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agy-paths-test-"));
  const ideRoot = path.join(tempRoot, "Antigravity IDE");
  const defaultRoot = path.join(tempRoot, "local", "Programs", "Antigravity");

  try {
    await mkdir(path.join(ideRoot, "resources"), { recursive: true });
    await Promise.all([
      writeFile(path.join(ideRoot, "Antigravity IDE.exe"), "ide"),
      writeFile(path.join(ideRoot, "resources", "app.asar"), "ide-asar"),
      createDesktopInstall(defaultRoot),
    ]);
    const resolved = await resolveInstallRoot({
      env: { LOCALAPPDATA: path.join(tempRoot, "local") },
      platform: "win32",
      findWindowsCandidates: async () => [
        {
          source: "registry",
          value: path.join(ideRoot, "Antigravity IDE.exe"),
        },
      ],
    });

    assert.equal(resolved.installRoot, defaultRoot);
    assert.equal(resolved.source, "default");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("multiple valid registry paths require an explicit override", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agy-paths-test-"));
  const firstRoot = path.join(tempRoot, "first");
  const secondRoot = path.join(tempRoot, "second");

  try {
    await Promise.all([
      createDesktopInstall(firstRoot),
      createDesktopInstall(secondRoot),
    ]);
    await assert.rejects(
      () =>
        resolveInstallRoot({
          env: {},
          platform: "win32",
          findWindowsCandidates: async () => [
            {
              source: "registry",
              value: path.join(firstRoot, "Antigravity.exe"),
            },
            {
              source: "registry",
              value: path.join(secondRoot, "Antigravity.exe"),
            },
          ],
        }),
      /多个 Antigravity Desktop 安装目录.*AGY_INSTALL_PATH/,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("an invalid explicit override returns an actionable error", async () => {
  const missingRoot = path.join(os.tmpdir(), "agy-paths-missing");
  await assert.rejects(
    () =>
      resolveInstallRoot({
        env: { AGY_INSTALL_PATH: missingRoot },
        platform: "win32",
      }),
    /AGY_INSTALL_PATH 指向的目录不是有效的/,
  );
});

test("a failed Windows query still falls back to the default path", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agy-paths-test-"));
  const defaultRoot = path.join(tempRoot, "local", "Programs", "Antigravity");

  try {
    await createDesktopInstall(defaultRoot);
    const resolved = await resolveInstallRoot({
      env: { LOCALAPPDATA: path.join(tempRoot, "local") },
      platform: "win32",
      findWindowsCandidates: async () => {
        throw new Error("PowerShell unavailable");
      },
    });

    assert.equal(resolved.installRoot, defaultRoot);
    assert.equal(resolved.source, "default");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("missing installations return setup guidance", async () => {
  await assert.rejects(
    () =>
      resolveInstallRoot({
        env: {},
        platform: "win32",
        findWindowsCandidates: async () => [],
      }),
    /未找到有效的 Antigravity Desktop 安装目录.*AGY_INSTALL_PATH/,
  );
});
