// Copies the self-hosted TinyMCE assets from node_modules into public/tinymce
// so the editor loads offline (no cloud API key). Runs in `prebuild` and
// `postinstall`; safe to re-run (it refreshes the destination each time).
import { existsSync } from "node:fs";
import { cp, rm, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "node_modules/tinymce");
const dest = resolve(root, "public/tinymce");

if (!existsSync(src)) {
  // `tinymce` isn't installed yet (e.g. partial install) — skip silently.
  console.warn("[copy-tinymce] node_modules/tinymce not found, skipping.");
  process.exit(0);
}

await rm(dest, { recursive: true, force: true });
await mkdir(dirname(dest), { recursive: true });
await cp(src, dest, { recursive: true });
console.log(`[copy-tinymce] Copied TinyMCE assets -> ${dest}`);
