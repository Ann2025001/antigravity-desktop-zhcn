import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256File } from "../src/lib/hash.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const previousHash = "EF266F441112CEAE2A52E9FB10A60693EE8816833B50AF9AD80449DE31ACADC0";
const nextHash = "4D32AC97273024CAF8DDEFB0D7E473A500CD61B0D5891A4739433150F711CEE0";
const source = path.join(projectRoot, ".runtime", "build", "2.15.0", "agy_zhcn_ui_main.js");
const target = path.join(process.env.APPDATA, "Antigravity", "agy_zhcn_ui_main.js");
const state = path.join(process.env.LOCALAPPDATA, "AntigravityZhcn", "install-state.json");

if ((await sha256File(source)) !== nextHash) throw new Error("Prepared UI hash mismatch.");
if ((await sha256File(target)) !== previousHash) throw new Error("Installed UI changed unexpectedly; refusing overwrite.");
const staged = `${target}.${process.pid}.new`;
const displaced = `${target}.${process.pid}.old`;
await copyFile(source, staged);
if ((await sha256File(staged)) !== nextHash) throw new Error("Staged UI verification failed.");
await rename(target, displaced);
try {
  await rename(staged, target);
  if ((await sha256File(target)) !== nextHash) throw new Error("Installed UI verification failed.");
  const data = JSON.parse(await readFile(state, "utf8"));
  data.localizedBundleSha256 = nextHash;
  data.updatedAt = new Date().toISOString();
  await mkdir(path.dirname(state), { recursive: true });
  await writeFile(state, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rm(displaced, { force: true });
  console.log(`Updated localized UI: ${nextHash}`);
} catch (error) {
  await rm(target, { force: true }).catch(() => {});
  await rename(displaced, target).catch(() => {});
  await rm(staged, { force: true }).catch(() => {});
  throw error;
}
