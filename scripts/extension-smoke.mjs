/* global document */
/**
 * production closed Shadow DOM 과 호환되는 확장 스모크.
 * 패널 상태는 host light DOM data-* 미러로 읽고,
 * 버튼은 assembly-subtitle-panel-command CustomEvent 로 전달한다.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { chromium } from "playwright";

const extensionPath = resolve("dist");
const manifestPath = resolve(extensionPath, "manifest.json");

if (!existsSync(manifestPath)) {
  throw new Error("dist/manifest.json not found. Run npm run build first.");
}

const userDataDir = await mkdtemp(join(tmpdir(), "assembly-cc-extension-"));
const playerUrl =
  "https://assembly.webcast.go.kr/main/player.asp?xcode=10&xcgcd=DCM000010224330202";
const panelHostId = "assembly-subtitle-panel-host";
const panelCommandEvent = "assembly-subtitle-panel-command";

const fixtureHtml = String.raw`<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>국회 본회의 테스트</title>
  </head>
  <body>
    <button class="btn_subtit_ai">AI 자막보기</button>
    <div id="viewSubtit">
      <div class="smi_word row_a"><span style="color: rgb(35, 124, 147)">안정 자막 첫 줄입니다.</span></div>
      <div class="incont">안정 자막 첫 줄입니다.</div>
    </div>
    <iframe id="caption-frame" src="https://assembly.webcast.go.kr/main/player-frame-smoke"></iframe>
    <script>
      setTimeout(() => {
        document.querySelector("#viewSubtit").innerHTML =
          "<div class='incont'>fallback only stable text</div>";
      }, 2500);
    </script>
  </body>
</html>`;

const frameFixtureHtml = String.raw`<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>국회 프레임 자막 테스트</title>
  </head>
  <body>
    <div id="viewSubtit">
      <div class="smi_word row_b"><span>프레임 자막입니다.</span></div>
    </div>
  </body>
</html>`;

let context;
try {
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL || undefined,
    headless: process.env.EXTENSION_E2E_HEADLESS === "1",
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  const page = await context.newPage();
  await page.route("https://assembly.webcast.go.kr/main/player**", (route) => {
    const body = route.request().url().includes("player-frame-smoke")
      ? frameFixtureHtml
      : fixtureHtml;
    return route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body,
    });
  });

  await page.goto(playerUrl, { waitUntil: "domcontentloaded" });
  await page.locator(`#${panelHostId}`).waitFor({ state: "attached", timeout: 10_000 });
  await waitForPanelText(page, "국회 자막 도우미");
  await waitForPanelText(page, "수집 중");
  await waitForPanelText(page, "안정 자막 첫 줄입니다.");
  await waitForPanelText(page, "프레임 자막입니다.");

  await clickPanelButton(page, "멈추기");
  await waitForPanelText(page, "잠시 멈춤");
  await clickPanelButton(page, "자막 모으기");
  await waitForPanelText(page, "수집 중");
  await waitForPanelText(page, "fallback only stable text", 15_000);

  const historyPage = await context.newPage();
  await historyPage.goto(`chrome-extension://${await resolveExtensionId(context)}/history.html`);
  await historyPage.getByText("저장된 자막 기록").waitFor({ timeout: 10_000 });

  console.log("Extension smoke test passed.");
} finally {
  await context?.close();
  await rm(userDataDir, { recursive: true, force: true });
}

async function waitForPanelText(page, text, timeout = 10_000) {
  await page.waitForFunction(
    ({ hostId, expectedText }) => {
      const host = document.getElementById(hostId);
      if (!host) {
        return false;
      }
      const lightMirror = [
        host.dataset.assemblyStatusLabel,
        host.dataset.assemblyNotice,
        host.dataset.assemblyPreview,
        host.dataset.assemblyLiveText,
        host.dataset.assemblyStatus,
        host.dataset.assemblyCaptureMode,
      ]
        .filter(Boolean)
        .join("\n");
      const shadowText = host.shadowRoot?.textContent ?? "";
      const surface = `${lightMirror}\n${shadowText}`;
      // 앱 이름 등은 light mirror 에 없을 수 있어 호스트 존재 + 일부 텍스트는 status 로 판별
      if (expectedText === "국회 자막 도우미") {
        return host.dataset.assemblyPanel === "1" || Boolean(shadowText.includes(expectedText));
      }
      return surface.includes(expectedText);
    },
    { hostId: panelHostId, expectedText: text },
    { timeout },
  );
}

async function clickPanelButton(page, label) {
  const clicked = await page.evaluate(
    ({ hostId, buttonLabel, commandEvent }) => {
      const host = document.getElementById(hostId);
      if (!host) {
        return false;
      }
      // closed shadow: content script 가 수신하는 명령 이벤트
      host.dispatchEvent(
        new CustomEvent(commandEvent, {
          detail: { type: "click-button", label: buttonLabel },
        }),
      );
      return true;
    },
    { hostId: panelHostId, buttonLabel: label, commandEvent: panelCommandEvent },
  );
  if (!clicked) {
    throw new Error(`Panel host not found for command: ${label}`);
  }
}

async function resolveExtensionId(browserContext) {
  let [serviceWorker] = browserContext.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await browserContext.waitForEvent("serviceworker", { timeout: 10_000 });
  }
  const url = serviceWorker.url();
  const [, extensionId] = url.match(/^chrome-extension:\/\/([^/]+)\//) ?? [];
  if (!extensionId) {
    throw new Error(`Unable to resolve extension id from service worker URL: ${url}`);
  }
  return extensionId;
}

