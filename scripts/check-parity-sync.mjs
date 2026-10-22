// parity/ 사본을 데스크톱 저장소(korea-assembly-cc)와 비교한다.
// 형제 저장소가 없으면(CI 등) 건너뛴다. `--write` 를 주면 이 저장소 사본을 데스크톱 쪽에 복사한다.
import { access, copyFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const PARITY_FILES = [
  "README.md",
  "capture-contract.json",
  "pipeline-vectors.json",
];

const siblingRoot = resolve(
  process.env.KOREA_ASSEMBLY_CC_DIR ?? resolve("..", "korea-assembly-cc"),
);
const siblingParity = resolve(siblingRoot, "parity");
const write = process.argv.includes("--write");

try {
  await access(siblingParity);
} catch {
  console.log(
    `Parity sync skipped: desktop repository not found at ${siblingParity} (set KOREA_ASSEMBLY_CC_DIR)`,
  );
  process.exit(0);
}

const mismatches = [];
for (const name of PARITY_FILES) {
  const local = resolve("parity", name);
  const sibling = resolve(siblingParity, name);
  if (write) {
    await copyFile(local, sibling);
    continue;
  }
  const [localText, siblingText] = await Promise.all([
    readFile(local, "utf8"),
    readFile(sibling, "utf8").catch(() => null),
  ]);
  if (siblingText === null) {
    mismatches.push(`${name}: missing in desktop repository`);
  } else if (
    localText.replace(/\r\n/g, "\n") !== siblingText.replace(/\r\n/g, "\n")
  ) {
    mismatches.push(`${name}: content differs`);
  }
}

if (write) {
  console.log(`Parity files copied to ${siblingParity}`);
} else if (mismatches.length) {
  throw new Error(
    `Parity files differ from ${siblingParity}:\n- ${mismatches.join("\n- ")}\n` +
      "Update both repositories (see parity/README.md).",
  );
} else {
  console.log(`Parity sync passed: ${siblingParity}`);
}
