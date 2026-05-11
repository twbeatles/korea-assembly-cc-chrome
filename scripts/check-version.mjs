import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const [packageJson, manifestJson] = await Promise.all([
  readFile(resolve("package.json"), "utf8").then(JSON.parse),
  readFile(resolve("manifest.json"), "utf8").then(JSON.parse),
]);

if (packageJson.version !== manifestJson.version) {
  throw new Error(
    `Version mismatch: package.json=${packageJson.version}, manifest.json=${manifestJson.version}`,
  );
}

console.log(`Version check passed: ${packageJson.version}`);
