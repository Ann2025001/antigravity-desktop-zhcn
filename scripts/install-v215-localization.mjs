import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAntigravityRunning } from "../src/lib/processes.mjs";
import { sha256File } from "../src/lib/hash.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const originalHash = "BDE8B6F7602B58974F250A4FD4CF21DF8575DAA1E60B0AA66168C9D12C2D9639";
const patchedHash = "ABD9D7E579F89D87F5290EC90B005DF627A61B6E5DB65AD601640333FE41B3AA";
const localizedHash = "94B761C15A1214C7FC6280699834A292E397D2402EDA2A36778784C29F17AC9E";
const installRoot = path.join(process.env.LOCALAPPDATA, "Programs", "antigravity");
const appAsarPath = path.join(installRoot, "resources", "app.asar");
const builtAsarPath = path.join(projectRoot, ".runtime", "build", "2.15.0", "app.asar");
const builtUiPath = path.join(projectRoot, ".runtime", "build", "2.15.0", "agy_zhcn_ui_main.js");
const stateRoot = path.join(process.env.LOCALAPPDATA, "AntigravityZhcn");
const backupPath = path.join(stateRoot, "backups", "2.15.0", originalHash, "app.asar");
const statePath = path.join(stateRoot, "install-state.json");
const installedUiPath = path.join(process.env.APPDATA, "Antigravity", "agy_zhcn_ui_main.js");

if (await isAntigravityRunning()) throw new Error("Antigravity is still running; installation refused.");
if ((await sha256File(appAsarPath)) !== originalHash) throw new Error("Installed app.asar changed; installation refused.");
if ((await sha256File(builtAsarPath)) !== patchedHash) throw new Error("Built ASAR hash mismatch.");
if ((await sha256File(builtUiPath)) !== localizedHash) throw new Error("Built UI hash mismatch.");

await mkdir(path.dirname(backupPath), { recursive: true });
try {
  const existingBackup = await sha256File(backupPath);
  if (existingBackup !== originalHash) throw new Error("Existing backup hash mismatch.");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  await copyFile(appAsarPath, backupPath);
  if ((await sha256File(backupPath)) !== originalHash) throw new Error("Backup verification failed.");
}

try {
  await sha256File(installedUiPath);
  throw new Error("Existing localized UI file found; installation refused to overwrite it.");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const token = `${process.pid}-${Date.now()}`;
const stagedAsar = path.join(path.dirname(appAsarPath), `.agy-zhcn-${token}.new`);
const displacedAsar = path.join(path.dirname(appAsarPath), `.agy-zhcn-${token}.old`);
const stagedUi = `${installedUiPath}.${token}.new`;
await copyFile(builtAsarPath, stagedAsar);
await copyFile(builtUiPath, stagedUi);
if ((await sha256File(stagedAsar)) !== patchedHash || (await sha256File(stagedUi)) !== localizedHash) {
  throw new Error("Staged file verification failed.");
}

let asarReplaced = false;
try {
  await rename(appAsarPath, displacedAsar);
  await rename(stagedAsar, appAsarPath);
  asarReplaced = true;
  if ((await sha256File(appAsarPath)) !== patchedHash) throw new Error("Installed ASAR verification failed.");
  await rename(stagedUi, installedUiPath);
  if ((await sha256File(installedUiPath)) !== localizedHash) throw new Error("Installed UI verification failed.");
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify({
    schemaVersion: 1,
    status: "installed",
    appVersion: "2.15.0",
    installedAt: new Date().toISOString(),
    installRoot,
    originalAsarSha256: originalHash,
    patchedAsarSha256: patchedHash,
    backupPath,
    installedBundlePath: installedUiPath,
    localizedBundleSha256: localizedHash
  }, null, 2)}\n`, "utf8");
  await rm(displacedAsar, { force: true });
  console.log(`Backup: ${backupPath}`);
  console.log(`Installed ASAR: ${patchedHash}`);
  console.log(`Installed UI: ${localizedHash}`);
} catch (error) {
  if (asarReplaced) {
    await rm(appAsarPath, { force: true }).catch(() => {});
    await rename(displacedAsar, appAsarPath).catch(() => {});
  }
  await rm(stagedAsar, { force: true }).catch(() => {});
  await rm(stagedUi, { force: true }).catch(() => {});
  throw error;
}
