import assert from "node:assert/strict";
import test from "node:test";
import { getAsarEntry } from "../src/lib/asar-reader.mjs";

const header = {
  files: {
    dist: {
      files: {
        "main.js": {
          size: 12,
          offset: "0",
        },
      },
    },
  },
};

test("getAsarEntry resolves a normalized archive path", () => {
  assert.deepEqual(getAsarEntry(header, "dist\\main.js"), {
    size: 12,
    offset: "0",
  });
});

test("getAsarEntry reports missing files", () => {
  assert.throws(() => getAsarEntry(header, "dist/missing.js"), /不存在文件/);
});
