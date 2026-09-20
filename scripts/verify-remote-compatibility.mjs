import { loadCompatibilityManifest } from "../src/lib/installation.mjs";
import {
  mergeCompatibilityManifests,
  verifyTrackedRemoteCompatibility,
} from "../src/lib/remote-compatibility.mjs";

const [localManifest, remoteDocument] = await Promise.all([
  loadCompatibilityManifest(),
  verifyTrackedRemoteCompatibility(),
]);
const merged = mergeCompatibilityManifests(localManifest, remoteDocument);
console.log(`远程兼容性签名验证通过：序号 ${remoteDocument.sequence}`);
console.log(`签名清单目标: ${remoteDocument.targets.length}`);
console.log(`合并后目标: ${merged.targets.length}`);
