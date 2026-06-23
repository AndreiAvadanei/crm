import "server-only";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const ROOT = process.env.UPLOADS_DIR || "./data/uploads";

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

export async function saveFile(
  data: Buffer,
  originalName: string
): Promise<{ storageKey: string; size: number }> {
  const now = new Date();
  const dir = path.join(String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, "0"));
  const key = path.join(dir, `${crypto.randomUUID()}-${safeName(originalName)}`);
  const absDir = path.join(ROOT, dir);
  await fs.mkdir(absDir, { recursive: true });
  await fs.writeFile(path.join(ROOT, key), data);
  return { storageKey: key, size: data.length };
}

export async function readFile(storageKey: string): Promise<Buffer> {
  return fs.readFile(path.join(ROOT, storageKey));
}

export async function deleteFile(storageKey: string): Promise<void> {
  await fs.unlink(path.join(ROOT, storageKey)).catch(() => {});
}
