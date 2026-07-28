/**
 * orchestrator/ 하위 파일의 import 깊이를 runtime/ 기준에서 +1 단계로 보정.
 */
import fs from "node:fs";
import path from "node:path";

const dir = path.join("src/content/app/runtime/orchestrator");

function fixContent(s) {
  // Parent runtime modules: ./constants, ./types → ../
  s = s.replace(/from "\.\/constants"/g, 'from "../constants"');
  s = s.replace(/from "\.\/types"/g, 'from "../types"');
  s = s.replace(/from "\.\/\.\.\/constants"/g, 'from "../constants"');

  // content/* was ../../X from runtime/, now ../../../X
  // shared/core/storage was ../../../X from runtime/, now ../../../../X
  // Be careful order: replace deeper first isn't needed if we use exact prefixes.

  // First, content-level relatives that were ../../
  // From runtime/orchestrator.ts: ../../autosave, ../../runtime/, ../../frame-probe, etc.
  const contentPaths = [
    "autosave",
    "runtime/",
    "frame-probe",
    "inpage-panel",
    "panel-live-rows",
    "failed-stopped-session",
    "capture-notice",
    "local-polling",
    "dom-probe",
    "unconfirmed-fallback",
    "subtitle-layer",
    "popup-bridge",
    "frame-coordinator",
    "page-exit-persist",
    "session-lifecycle",
    "subtitle-event-handler",
    "persistability",
  ];

  // If already fixed (../../../autosave), don't double-fix.
  // Pattern: from "../../autosave" → from "../../../autosave"
  for (const p of contentPaths) {
    const from = `from "../../${p}`;
    const to = `from "../../../${p}`;
    // only if not already ../../../
    s = s.split(`from "../../../${p}`).join("__ALREADY_CONTENT__" + p);
    s = s.split(from).join(to);
    s = s.split("__ALREADY_CONTENT__" + p).join(`from "../../../${p}`);
  }

  // src-level: ../../../core, shared, storage → ../../../../
  for (const p of ["core/", "shared/", "storage/"]) {
    s = s.split(`from "../../../../${p}`).join("__ALREADY_SRC__" + p);
    s = s.split(`from "../../../${p}`).join(`from "../../../../${p}`);
    s = s.split("__ALREADY_SRC__" + p).join(`from "../../../../${p}`);
  }

  // context was ../context from runtime/ → ../context still? 
  // runtime/orchestrator.ts had: from "../context" which is runtime/../context = content/app/context
  // Wait: orchestrator was at content/app/runtime/orchestrator.ts
  // ../context = content/app/context - correct
  // Now at content/app/runtime/orchestrator/impl.ts
  // ../context = content/app/runtime/context - WRONG
  // ../../context = content/app/context - correct
  s = s.split('from "../../context"').join("__CTX__");
  s = s.split('from "../context"').join('from "../../context"');
  s = s.split("__CTX__").join('from "../../context"');

  return s;
}

for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith(".ts")) continue;
  const p = path.join(dir, f);
  // skip index facade if only re-exports local
  let s = fs.readFileSync(p, "utf8");
  const next = fixContent(s);
  if (next !== s) {
    fs.writeFileSync(p, next);
    console.log("fixed", f);
  } else {
    console.log("unchanged", f);
  }
}

// verify one sample
const sample = fs.readFileSync(path.join(dir, "impl.ts"), "utf8").split("\n").slice(0, 30);
console.log("--- sample ---");
sample.forEach((l) => console.log(l));
