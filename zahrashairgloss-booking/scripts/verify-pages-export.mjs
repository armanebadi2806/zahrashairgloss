import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, "..");
const repoRoot = resolve(appRoot, "..");
const distRoot = join(appRoot, "dist");
const rootAssets = join(repoRoot, "assets");
const distAssets = join(distRoot, "assets");

const distIndex = readFileSync(join(distRoot, "index.html"), "utf8");
const rootIndex = readFileSync(join(repoRoot, "index.html"), "utf8");

if (distIndex !== rootIndex) {
  throw new Error("Root index.html und dist/index.html sind nicht synchron.");
}

const assetMatch = rootIndex.match(/src="([^"]*assets\/[^"]+\.js)"/);
if (!assetMatch) {
  throw new Error("In index.html wurde kein JS-Bundle gefunden.");
}

const assetPath = assetMatch[1].replace(/^\.?\//, "");
if (!existsSync(join(repoRoot, assetPath))) {
  throw new Error(`Das referenzierte Bundle fehlt: ${assetPath}`);
}

const distAssetNames = readdirSync(distAssets).sort().join("\n");
const rootAssetNames = readdirSync(rootAssets).sort().join("\n");

if (distAssetNames !== rootAssetNames) {
  throw new Error("Root assets und dist/assets enthalten unterschiedliche Dateien.");
}

const bootstrapBundle = readFileSync(join(repoRoot, assetPath), "utf8");
const mainBundleMatch = bootstrapBundle.match(/import\("\.\/(main[^"]+\.js)"\)/);
if (!mainBundleMatch) {
  throw new Error("Das Hauptbundle konnte im Bootstrap-Bundle nicht gefunden werden.");
}

const mainBundlePath = join(repoRoot, "assets", mainBundleMatch[1]);
if (!existsSync(mainBundlePath)) {
  throw new Error(`Das Hauptbundle fehlt: assets/${mainBundleMatch[1]}`);
}

const rootBundle = readFileSync(mainBundlePath, "utf8");
for (const snippet of ["notification-entry", "onClick:()=>Ft(H)", "Noch nicht bestätigt"]) {
  if (!rootBundle.includes(snippet)) {
    throw new Error(`Wichtiger Admin-Hinweis fehlt im Bundle: ${snippet}`);
  }
}

console.log("Pages-Export ist synchron und enthaelt den Admin-Build.");
