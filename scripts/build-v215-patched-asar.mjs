import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getAsarEntry,
  readAsarHeader,
  readFileFromAsar,
  readJsonFromAsar,
} from "../src/lib/asar-reader.mjs";
import { sha256Buffer, sha256File } from "../src/lib/hash.mjs";
import { patchCustomSchemeSource } from "../src/lib/patcher.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceAsarPath = process.argv[2];
const outputAsarPath = process.argv[3];
const customSchemePath = "dist/customScheme.js";
const expectedSourceHash = "BDE8B6F7602B58974F250A4FD4CF21DF8575DAA1E60B0AA66168C9D12C2D9639";
const expectedSchemeHash = "6A533F37C2C26D405CFD7BC0C2A629803BDBDD843924BD3306D4E6F1087A4E98";

if (!sourceAsarPath || !outputAsarPath) {
  throw new Error("Usage: node scripts/build-v215-patched-asar.mjs <source.asar> <output.asar>");
}
if ((await sha256File(sourceAsarPath)) !== expectedSourceHash) {
  throw new Error("Source ASAR fingerprint does not match Antigravity Desktop 2.15.0.");
}

function alignToFour(value) {
  return value + ((4 - (value % 4)) % 4);
}

function serializeAsarHeader(header) {
  const jsonBuffer = Buffer.from(JSON.stringify(header), "utf8");
  const stringPayloadSize = 4 + alignToFour(jsonBuffer.length);
  const headerPickle = Buffer.alloc(4 + stringPayloadSize);
  headerPickle.writeUInt32LE(stringPayloadSize, 0);
  headerPickle.writeInt32LE(jsonBuffer.length, 4);
  jsonBuffer.copy(headerPickle, 8);
  const sizePickle = Buffer.alloc(8);
  sizePickle.writeUInt32LE(4, 0);
  sizePickle.writeUInt32LE(headerPickle.length, 4);
  return Buffer.concat([sizePickle, headerPickle]);
}

const { header, dataOffset } = await readAsarHeader(sourceAsarPath);
const schemeEntry = getAsarEntry(header, customSchemePath);
if (!schemeEntry || schemeEntry.unpacked) {
  throw new Error("Expected packed customScheme.js entry was not found.");
}
const originalScheme = await readFileFromAsar(sourceAsarPath, customSchemePath);
if (sha256Buffer(originalScheme) !== expectedSchemeHash) {
  throw new Error("customScheme.js fingerprint mismatch.");
}
const patchedScheme = Buffer.from(
  patchCustomSchemeSource(originalScheme.toString("utf8")),
  "utf8",
);
const source = await readFile(sourceAsarPath);
const originalData = source.subarray(dataOffset);
schemeEntry.offset = String(originalData.length);
schemeEntry.size = patchedScheme.length;
const serializedHeader = serializeAsarHeader(header);

await mkdir(path.dirname(outputAsarPath), { recursive: true });
await writeFile(outputAsarPath, Buffer.concat([serializedHeader, originalData, patchedScheme]));

const outputPackage = await readJsonFromAsar(outputAsarPath, "package.json");
const verifiedScheme = await readFileFromAsar(outputAsarPath, customSchemePath);
if (outputPackage.version !== "2.15.0") throw new Error("Patched package version mismatch.");
if (!verifiedScheme.toString("utf8").includes("agy-zhcn://bundle/main.js")) {
  throw new Error("Patched ASAR content verification failed.");
}

console.log(`Source SHA256: ${expectedSourceHash}`);
console.log(`Patched SHA256: ${await sha256File(outputAsarPath)}`);
console.log(`Patched scheme SHA256: ${sha256Buffer(verifiedScheme)}`);
console.log(`Output: ${path.resolve(outputAsarPath)}`);
