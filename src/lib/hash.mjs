import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex").toUpperCase();
}
