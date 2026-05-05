import { rmSync } from "node:fs";

const generatedPaths = [
  "apps/desktop/dist/main",
  "apps/desktop/dist/renderer",
  "dist"
];

for (const path of generatedPaths) {
  rmSync(path, { force: true, recursive: true });
}

console.log("Cleaned generated Electron bundles.");
