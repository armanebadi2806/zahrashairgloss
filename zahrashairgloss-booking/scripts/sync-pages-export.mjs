import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, "..");
const repoRoot = resolve(appRoot, "..");
const distRoot = join(appRoot, "dist");
const distAssets = join(distRoot, "assets");
const rootAssets = join(repoRoot, "assets");

if (!existsSync(distRoot)) {
  throw new Error("dist wurde nicht gefunden. Bitte zuerst den Build ausfuehren.");
}

rmSync(rootAssets, { recursive: true, force: true });
mkdirSync(rootAssets, { recursive: true });
cpSync(distAssets, rootAssets, { recursive: true });

for (const file of ["index.html", "qa-comparison.html"]) {
  cpSync(join(distRoot, file), join(repoRoot, file));
}

for (const entry of readdirSync(rootAssets)) {
  if (!existsSync(join(distAssets, entry))) {
    rmSync(join(rootAssets, entry), { recursive: true, force: true });
  }
}
