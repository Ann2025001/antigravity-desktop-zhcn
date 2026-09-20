import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStateRoot } from "./paths.mjs";

export function getInstallStatePath() {
  return path.join(getStateRoot(), "install-state.json");
}

export async function readInstallState() {
  try {
    return JSON.parse(await readFile(getInstallStatePath(), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeInstallState(state) {
  const statePath = getInstallStatePath();
  await mkdir(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, statePath);
}
