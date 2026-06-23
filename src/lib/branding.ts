import "server-only";
import fs from "fs/promises";
import path from "path";

// Project logos are stored at fixed paths in the uploads volume so no DB/schema
// change is needed. Existence + mtime double as a cache-busting "version".

const ROOT = process.env.UPLOADS_DIR || "./data/uploads";
const DIR = path.join(ROOT, "branding");

export type LogoMode = "light" | "dark";

function fileFor(mode: LogoMode) {
  return path.join(DIR, `logo-${mode}.png`);
}

export async function saveBrandingLogo(mode: LogoMode, data: Buffer): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(fileFor(mode), data);
}

export async function readBrandingLogo(mode: LogoMode): Promise<Buffer | null> {
  try {
    return await fs.readFile(fileFor(mode));
  } catch {
    return null;
  }
}

export async function deleteBrandingLogo(mode: LogoMode): Promise<void> {
  await fs.unlink(fileFor(mode)).catch(() => {});
}

/** Returns the file mtime in ms (0 when missing). Used for existence + cache busting. */
export async function brandingLogoVersion(mode: LogoMode): Promise<number> {
  try {
    const s = await fs.stat(fileFor(mode));
    return Math.floor(s.mtimeMs);
  } catch {
    return 0;
  }
}
