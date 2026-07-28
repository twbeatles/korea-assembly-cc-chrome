import fs from "node:fs";
import path from "node:path";

const dir = "src/core/subtitle-pipeline";

for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith(".ts")) continue;
  const p = path.join(dir, f);
  let s = fs.readFileSync(p, "utf8");
  const before = s;
  s = s.replace(/from "\.\/subtitle-models"/g, 'from "../subtitle-models"');
  s = s.replace(/from "\.\/text-normalizer"/g, 'from "../text-normalizer"');
  s = s.replace(/from "\.\/noise-filter"/g, 'from "../noise-filter"');
  s = s.replace(/from "\.\/timeline"/g, 'from "../timeline"');
  s = s.replace(/from "\.\.\/shared\//g, 'from "../../shared/');
  s = s.replace(/from "\.\.\/storage\//g, 'from "../../storage/');
  if (s !== before) {
    fs.writeFileSync(p, s);
    console.log("fixed", f);
  } else {
    console.log("nochange", f);
  }
}

function exportFn(file, names) {
  const p = path.join(dir, file);
  let s = fs.readFileSync(p, "utf8");
  for (const n of names) {
    s = s.replace(new RegExp(`^function ${n}\\b`, "m"), `export function ${n}`);
  }
  fs.writeFileSync(p, s);
  console.log("exported", file, names.join(","));
}

exportFn("history.ts", [
  "resolveConfirmedCompactMaxLength",
  "rebuildConfirmedHistory",
  "softResyncHistory",
  "resolveRecentHistoryCompactLength",
  "resolveRecentDuplicateMinLength",
  "buildRecentCompactHistory",
]);
exportFn("extract.ts", [
  "extractIncrementalTextWithRecentHistory",
  "sliceFromCompactIndex",
  "findCompactSuffixPrefixOverlap",
]);
