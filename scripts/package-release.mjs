/**
 * 배포용 CWS zip 생성. 버전 증가도 함께 처리한다.
 *
 *   node scripts/package-release.mjs                  # 현재 버전으로 빌드 + zip
 *   node scripts/package-release.mjs --skip-build      # dist 그대로 zip
 *   node scripts/package-release.mjs --bump patch      # 1.0.17 -> 1.0.18 후 빌드 + zip
 *   node scripts/package-release.mjs --version 1.1.0   # 지정 버전으로 후 빌드 + zip
 *   --overwrite: 같은 이름의 zip 이 있어도 새로 만든다.
 *   (npm 이 --force 를 가로채므로 스크립트 플래그는 --overwrite 를 쓴다.)
 *
 * 버전은 package.json + manifest.json + package-lock.json 루트를 함께 올린다.
 * zip 은 dist/ 내부 파일만 최상위에 넣고, 바이트 일치까지 검증한다.
 * zip 은 .gitignore 대상이라 커밋하지 않는다.
 */
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flagValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const hasFlag = (name) => args.includes(name);

const BUMP = flagValue("--bump");
const NEXT_VERSION = flagValue("--version");
const SKIP_BUILD = hasFlag("--skip-build");
const FORCE = hasFlag("--overwrite");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function assertChromeVersion(version) {
  const parts = version.split(".");
  const ok =
    parts.length >= 1 &&
    parts.length <= 4 &&
    parts.every((part) => /^\d+$/.test(part) && Number(part) <= 65535);
  if (!ok) {
    throw new Error(`Invalid Chrome extension version: ${version}`);
  }
}

function bumpVersion(current, bump) {
  const [major, minor, patch] = current.split(".").map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown --bump: ${bump} (patch|minor|major)`);
}

function runBuild() {
  // Windows 에서는 .cmd 를 직접 실행할 수 없어 셸을 거친다.
  const result = spawnSync("npm run build", { stdio: "inherit", shell: true });
  if (result.status !== 0) {
    throw new Error("npm run build failed.");
  }
}

function runPython(code) {
  for (const python of ["python", "py"]) {
    try {
      const extra = python === "py" ? ["-3"] : [];
      return execFileSync(python, [...extra, "-c", code], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      }).trim();
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
  }
  throw new Error("Python 3 is required to create the release zip.");
}

const packageJson = readJson("package.json");
if (BUMP || NEXT_VERSION) {
  const next = NEXT_VERSION ?? bumpVersion(packageJson.version, BUMP);
  assertChromeVersion(next);
  packageJson.version = next;
  writeJson("package.json", packageJson);
  const manifest = readJson("manifest.json");
  manifest.version = next;
  writeJson("manifest.json", manifest);
  const lock = readJson("package-lock.json");
  lock.version = next;
  if (lock.packages?.[""]) lock.packages[""].version = next;
  writeJson("package-lock.json", lock);
  console.log(`Version bumped: ${next}`);
}

const version = readJson("package.json").version;
if (readJson("manifest.json").version !== version) {
  throw new Error("Version mismatch between package.json and manifest.json.");
}

if (!SKIP_BUILD) {
  runBuild();
}

const distVersion = readJson("dist/manifest.json").version;
if (distVersion !== version) {
  throw new Error(
    `dist/manifest.json version ${distVersion} != ${version}. Rebuild first.`,
  );
}

const zipName = `korea-assembly-cc-chrome-${version}-cws.zip`;
const zipResult = runPython(
  [
    "import pathlib,zipfile",
    "p=pathlib.Path('dist')",
    `z=zipfile.ZipFile(${JSON.stringify(zipName)},${FORCE ? "'w'" : "'x'"},zipfile.ZIP_DEFLATED)`,
    "[z.write(f,f.relative_to(p).as_posix()) for f in sorted(p.rglob('*')) if f.is_file()]",
    "z.close()",
    "print('zip-created')",
  ].join(";"),
);
if (zipResult !== "zip-created" || !existsSync(zipName)) {
  throw new Error("Zip creation failed.");
}

// 바이트 일치 검증: zip namelist == dist 파일 목록, CRC == dist 바이트
const verifyResult = runPython(
  [
    "import pathlib,zipfile,zlib",
    "p=pathlib.Path('dist')",
    `z=zipfile.ZipFile(${JSON.stringify(zipName)})`,
    "expected=sorted(f.relative_to(p).as_posix() for f in p.rglob('*') if f.is_file())",
    "actual=sorted(z.namelist())",
    "assert expected==actual, 'namelist mismatch: '+repr(actual)",
    "mismatched=[n for n in expected if z.getinfo(n).CRC != (zlib.crc32((p/n).read_bytes()) & 0xffffffff)]",
    "assert not mismatched, 'crc mismatch: '+repr(mismatched)",
    "print('zip-verified')",
  ].join(";"),
);
if (verifyResult !== "zip-verified") {
  throw new Error("Zip verification failed.");
}

const sha256 = createHash("sha256").update(readFileSync(zipName)).digest("hex");
console.log(`Packaged: ${zipName}`);
console.log(`SHA-256: ${sha256}`);
