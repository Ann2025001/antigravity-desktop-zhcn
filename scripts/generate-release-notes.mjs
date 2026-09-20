import { loadCompatibilityManifest } from "../src/lib/installation.mjs";
import { buildReleaseCompatibilityNotes } from "../src/lib/release-notes.mjs";

const manifest = await loadCompatibilityManifest();
process.stdout.write(`${buildReleaseCompatibilityNotes(manifest)}\n`);
