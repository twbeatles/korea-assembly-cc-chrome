/* global document, chrome, window */
/**
 * production closed Shadow DOM 과 호환되는 확장 스모크.
 * 패널 상태는 host light DOM data-* 미러로 읽고,
 * 버튼은 assembly-subtitle-panel-command CustomEvent 로 전달한다.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

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
  </body>
</html>`;

const frameFixtureHtml = String.raw`<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>국회 프레임 자막 테스트</title>
  </head>
  <body>
    <div id="viewSubtit"></div>
  </body>
</html>`;

let context;
const pageErrors = [];
try {
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL || "chromium",
    headless: process.env.EXTENSION_E2E_HEADLESS === "1",
    acceptDownloads: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  context.setDefaultTimeout(15_000);
  context.on("page", (page) => {
    page.on("pageerror", (error) => pageErrors.push(error.message));
  });

  const page = await context.newPage();
  const downloadDir = join(userDataDir, "downloads");
  await mkdir(downloadDir);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadDir,
  });
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
  await page
    .locator(`#${panelHostId}`)
    .waitFor({ state: "attached", timeout: 10_000 });
  await page.evaluate((hostId) => {
    const host = document.getElementById(hostId);
    if (host) {
      host.dataset.assemblyE2e = "1";
    }
  }, panelHostId);
  await waitForPanelText(page, "국회 자막 도우미");
  await waitForPanelText(page, "수집 중");
  await waitForPanelText(page, "안정 자막 첫 줄입니다.");
  // Advance the fixture only after each result is observed. Wall-clock fixture
  // timers used to erase the first subtitle before slow CI could assert it.
  // Source arbitration favors a populated top frame; empty it before testing
  // the iframe source, as happens when a player moves captions into its frame.
  await page.locator("#viewSubtit").evaluate((node) => node.replaceChildren());
  await page
    .frameLocator("#caption-frame")
    .locator("#viewSubtit")
    .evaluate((node) => {
      node.innerHTML =
        '<div class="smi_word row_b"><span>프레임 자막입니다.</span></div>';
    });
  await waitForPanelText(page, "프레임 자막입니다.");
  await page.waitForFunction(
    (hostId) =>
      document
        .getElementById(hostId)
        ?.dataset.assemblyLiveText?.includes("프레임 자막입니다."),
    panelHostId,
  );
  const committedCount = Number(
    await page
      .locator(`#${panelHostId}`)
      .getAttribute("data-assembly-subtitle-count"),
  );

  await clickPanelButton(page, "수집 종료");
  await waitForPanelText(page, "잠시 멈춤");

  const historyPage = await context.newPage();
  await historyPage.goto(
    `chrome-extension://${await resolveExtensionId(context)}/history.html`,
  );
  await historyPage.getByText("저장된 자막 기록").waitFor({ timeout: 10_000 });
  await historyPage.locator(".session-item").first().click();
  const expectedTexts = ["안정 자막 첫 줄입니다.", "프레임 자막입니다."];
  for (const text of expectedTexts) {
    await historyPage
      .locator(".entry-card p")
      .filter({ hasText: text })
      .waitFor();
  }
  const committedTexts = await historyPage
    .locator(".entry-card p")
    .allTextContents();
  // The pipeline may merge adjacent phrases into one entry. Verify the complete
  // transcript, order, and absence of duplication independently of grouping.
  assert.equal(committedTexts.join(" "), expectedTexts.join(" "));
  assert.equal(committedTexts.length, committedCount);
  // A full page reload must recover the same captured data from real IndexedDB.
  await historyPage.reload();
  await historyPage.locator(".session-item").first().click();
  for (const text of expectedTexts) {
    await historyPage
      .locator(".entry-card p")
      .filter({ hasText: text })
      .waitFor();
  }
  assert.deepEqual(
    await historyPage.locator(".entry-card p").allTextContents(),
    committedTexts,
  );

  const formats = [
    ["json", "기록(JSON)"],
    ["txt", "텍스트(TXT)"],
    ["srt", "자막(SRT)"],
    ["vtt", "웹자막(VTT)"],
    ["md", "회의록(MD)"],
    ["csv", "표(CSV)"],
  ];
  let exportedSession;
  const downloadedIds = new Set();
  for (const [extension, label] of formats) {
    await historyPage.getByRole("button", { name: label, exact: true }).click();
    const item = await waitForDownload(historyPage, extension, downloadedIds);
    downloadedIds.add(item.id);
    const pathWithinTemp = relative(downloadDir, item.filename);
    assert.ok(
      !pathWithinTemp.startsWith("..") && !isAbsolute(pathWithinTemp),
      "Download must remain in the temporary test profile",
    );
    const content = await readFile(item.filename, "utf8");
    for (const text of expectedTexts)
      assert.ok(content.includes(text), `${extension} lost subtitle: ${text}`);
    if (extension === "json") {
      exportedSession = JSON.parse(content);
      assert.equal(exportedSession.status, "stopped");
      assert.ok(exportedSession.endedAt);
      assert.deepEqual(
        exportedSession.entries.map((entry) => entry.text),
        committedTexts,
      );
      assert.equal(exportedSession.subtitleCount, committedCount);
      assert.equal(
        exportedSession.charCount,
        committedTexts.reduce((sum, text) => sum + text.length, 0),
      );
      assert.equal(
        new Set(exportedSession.entries.map((entry) => entry.id)).size,
        committedCount,
      );
      assert.ok(
        exportedSession.entries.some(
          (entry) => entry.sourceFramePath?.length > 0,
        ),
        "Iframe provenance must survive storage and export",
      );
    }
    if (extension === "srt")
      assert.match(
        content,
        /\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/,
      );
    if (extension === "vtt") assert.ok(content.startsWith("WEBVTT"));
  }
  assert.ok(exportedSession);

  // Starting again creates a new capture. Confirm fallback text is committed,
  // then ensure it survives stop/reload without leaking the previous session.
  await page
    .frameLocator("#caption-frame")
    .locator("#viewSubtit")
    .evaluate((node) => node.replaceChildren());
  await page.locator("#viewSubtit").evaluate((node) => {
    node.innerHTML = '<div class="incont">fallback only stable text</div>';
  });
  await clickPanelButton(page, "수집 시작");
  await waitForPanelText(page, "수집 중");
  await page.waitForFunction(
    (hostId) =>
      document.getElementById(hostId)?.dataset.assemblyLiveText ===
      "fallback only stable text",
    panelHostId,
  );
  await clickPanelButton(page, "수집 종료");
  await waitForPanelText(page, "잠시 멈춤");
  await historyPage.reload();
  await historyPage.locator(".session-item").first().click();
  await historyPage
    .locator(".entry-card p")
    .filter({ hasText: "fallback only stable text" })
    .waitFor();
  assert.deepEqual(
    await historyPage.locator(".entry-card p").allTextContents(),
    ["fallback only stable text"],
  );
  assert.equal(await historyPage.locator(".session-item").count(), 2);
  await historyPage
    .getByRole("button", { name: "기록(JSON)", exact: true })
    .click();
  const fallbackDownload = await waitForDownload(
    historyPage,
    "json",
    downloadedIds,
  );
  const fallbackSession = JSON.parse(
    await readFile(fallbackDownload.filename, "utf8"),
  );
  assert.notEqual(fallbackSession.id, exportedSession.id);
  assert.deepEqual(
    fallbackSession.entries.map((entry) => entry.text),
    ["fallback only stable text"],
  );
  downloadedIds.add(fallbackDownload.id);

  // Use the real file input, UTF-8 reader, backup parser and IndexedDB writer.
  // A new identity avoids testing only the "already present" import shortcut.
  const importedSession = {
    ...exportedSession,
    id: "session_e2e_import",
    lineageId: "session_e2e_import",
    committeeName: "복원 검증위원회",
    note: "한글 및 이모지 복원 🎙️",
    entries: exportedSession.entries.map((entry) => ({
      ...entry,
      highlighted: true,
      entryNote: "행 메모 복원 🎙️",
      labels: ["복원 검증"],
      sourceEntryIds: [entry.id],
    })),
  };
  // 잠긴 상태의 파일 입력에 파일을 넣으면 가져오기가 조용히 무시되므로
  // 입력이 활성화될 때까지 기다렸다가 넣는다.
  await historyPage.waitForFunction(() => {
    const input = document.querySelector('input[type="file"]');
    return Boolean(input) && !input.disabled;
  });
  await historyPage.locator('input[type="file"]').setInputFiles({
    name: "roundtrip.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(importedSession), "utf8"),
  });
  try {
    await historyPage
      .getByText(
        "JSON 가져오기를 완료했습니다. 추가 1건 / 갱신 0건 / 유지 0건 / 실패 0건 / 무효 0건",
        { exact: true },
      )
      .waitFor();
  } catch (error) {
    const heroStatus = await historyPage
      .locator(".hero-status")
      .first()
      .textContent()
      .catch(() => null);
    const importInputState = await historyPage
      .evaluate(() => {
        const input = document.querySelector('input[type="file"]');
        return input ? { disabled: input.disabled } : null;
      })
      .catch(() => null);
    console.error(
      "JSON import confirmation not shown. hero-status:",
      heroStatus,
      "file-input:",
      JSON.stringify(importInputState),
    );
    throw error;
  }
  await historyPage.reload();
  await historyPage
    .locator(".session-item")
    .filter({ hasText: "복원 검증위원회" })
    .click();
  await historyPage
    .locator(".entry-card p")
    .filter({ hasText: expectedTexts[0] })
    .waitFor();
  assert.deepEqual(
    await historyPage.locator(".entry-card p").allTextContents(),
    committedTexts,
  );
  assert.equal(await historyPage.locator(".session-item").count(), 3);
  await historyPage
    .getByRole("button", { name: "기록(JSON)", exact: true })
    .click();
  const restoredDownload = await waitForDownload(
    historyPage,
    "json",
    downloadedIds,
  );
  const restoredSession = JSON.parse(
    await readFile(restoredDownload.filename, "utf8"),
  );
  assert.equal(restoredSession.id, importedSession.id);
  assert.equal(restoredSession.note, importedSession.note);
  assert.deepEqual(restoredSession.entries, importedSession.entries);

  // Exercise the production alertdialog; Vitest intentionally uses
  // window.confirm and cannot cover the focus trap or browser UI here.
  const deleteButton = historyPage
    .locator(".session-detail")
    .getByRole("button", { name: "삭제", exact: true });
  await deleteButton.click();
  const dialog = historyPage.getByRole("alertdialog");
  await dialog.waitFor();
  assert.equal(await dialog.getAttribute("aria-modal"), "true");
  const initiallyFocused = await historyPage.evaluate(
    () => document.activeElement?.textContent,
  );
  await historyPage.keyboard.press("Tab");
  assert.equal(
    await historyPage.evaluate(() => document.activeElement?.textContent),
    "취소",
  );
  await historyPage.keyboard.press("Tab");
  assert.equal(
    await historyPage.evaluate(() => document.activeElement?.textContent),
    initiallyFocused,
  );
  await historyPage.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await historyPage.reload();
  assert.equal(await historyPage.locator(".session-item").count(), 3);
  await historyPage
    .locator(".session-item")
    .filter({ hasText: "복원 검증위원회" })
    .click();
  await deleteButton.click();
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(await historyPage.locator(".session-item").count(), 3);

  // Exercise the complete library package, not just a single session export.
  downloadedIds.add(restoredDownload.id);
  await historyPage
    .getByRole("button", { name: "전체 JSON 백업", exact: true })
    .click();
  const libraryDownload = await waitForDownload(
    historyPage,
    "json",
    downloadedIds,
  );
  const libraryBundle = JSON.parse(
    await readFile(libraryDownload.filename, "utf8"),
  );
  assert.equal(libraryBundle.sessions.length, 3);
  assert.deepEqual(
    new Set(libraryBundle.sessions.map((record) => record.id)),
    new Set([exportedSession.id, fallbackSession.id, importedSession.id]),
  );
  libraryBundle.sessions = libraryBundle.sessions.map((record) => ({
    ...record,
    id: `library_${record.id}`,
    lineageId: `library_${record.id}`,
  }));
  await historyPage.locator('input[type="file"]').setInputFiles({
    name: "library-roundtrip.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(libraryBundle), "utf8"),
  });
  await historyPage
    .getByText(/JSON 가져오기를 완료했습니다\. 추가 3건/)
    .waitFor();
  await historyPage.reload();
  await historyPage.waitForFunction(
    () => document.querySelectorAll(".session-item").length === 6,
  );
  await exerciseCrossContextFallback(
    context,
    historyPage.url(),
    exportedSession,
  );

  await exerciseOffscreenRestart(context, historyPage);

  // Retain the original extension-page smoke coverage, checking rendered React
  // controls instead of accepting a static HTML document title as success.
  const extensionId = await resolveExtensionId(context);
  for (const [file, heading] of [
    ["options.html", "환경 설정"],
    ["sidepanel.html", "국회 자막 도우미"],
    ["popup.html", "국회 자막 도우미"],
  ]) {
    const surface = await context.newPage();
    await surface.goto(`chrome-extension://${extensionId}/${file}`);
    await surface
      .getByRole("heading", { name: heading, exact: true })
      .waitFor();
    if (file === "options.html")
      await surface
        .getByRole("button", { name: "저장", exact: true })
        .waitFor();
    else
      await surface
        .getByRole("button", { name: "환경 설정", exact: true })
        .waitFor();
    await surface.close();
  }
  assert.deepEqual(
    pageErrors,
    [],
    "Extension pages must not throw uncaught errors",
  );

  console.log(
    "Extension smoke passed: DOM + iframe capture → IndexedDB reload → six export formats → restart → JSON and library roundtrip → SW/History concurrent fallback.",
  );
} catch (error) {
  const reportDir = resolve("test-results/extension-smoke");
  await mkdir(reportDir, { recursive: true });
  for (const [index, page] of (context?.pages() ?? []).entries()) {
    if (page.isClosed()) continue;
    console.error(
      "Failed page:",
      page.url(),
      await page
        .locator(`#${panelHostId}`)
        .evaluateAll((hosts) => hosts.map((host) => ({ ...host.dataset }))),
    );
    await page
      .screenshot({
        path: join(reportDir, `page-${index}.png`),
        fullPage: true,
      })
      .catch(() => {});
  }
  console.error("Uncaught page errors:", pageErrors);
  throw error;
} finally {
  await context?.close();
  await rm(userDataDir, { recursive: true, force: true });
}

async function exerciseCrossContextFallback(
  browserContext,
  historyUrl,
  template,
) {
  const a = await browserContext.newPage();
  const b = await browserContext.newPage();
  const worker = browserContext.serviceWorkers()[0];
  for (const surface of [a, b]) {
    await surface.addInitScript(() =>
      Object.defineProperty(window, "indexedDB", {
        configurable: true,
        value: undefined,
      }),
    );
    await surface.goto(historyUrl);
    await surface.getByRole("heading", { name: "저장된 자막 기록" }).waitFor();
    await surface.waitForFunction(
      () => !document.querySelector('input[type="file"]').disabled,
    );
  }
  await worker.evaluate(() => {
    globalThis.auditOriginalIndexedDB = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: undefined,
    });
  });
  const records = [
    "session_e2e_fallback_sw",
    "session_e2e_fallback_history",
  ].map((id) => ({
    ...template,
    id,
    lineageId: id,
    status: "saved",
    updatedAt: new Date().toISOString(),
  }));
  try {
    const [response] = await Promise.all([
      a.evaluate(
        (record) =>
          chrome.runtime.sendMessage({
            type: "PERSIST_SESSION_RECORD",
            record,
          }),
        records[0],
      ),
      b.locator('input[type="file"]').setInputFiles({
        name: "independent-fallback.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(records[1]), "utf8"),
      }),
    ]);
    assert.equal(response.ok, true);
    await b.getByText(/JSON 가져오기를 완료했습니다\. 추가 1건/).waitFor();
    for (const surface of [a, b]) {
      await surface.reload();
      await surface.waitForFunction(
        () => document.querySelectorAll(".session-item").length === 2,
      );
    }
    const ids = await a.evaluate(
      async () =>
        (
          await chrome.storage.local.get(
            "assembly-subtitle-session-fallback:index",
          )
        )["assembly-subtitle-session-fallback:index"],
    );
    assert.deepEqual(new Set(ids), new Set(records.map((record) => record.id)));
  } finally {
    await worker.evaluate(() => {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: globalThis.auditOriginalIndexedDB,
      });
      delete globalThis.auditOriginalIndexedDB;
    });
    await a.close();
    await b.close();
  }
}

async function exerciseOffscreenRestart(browserContext, page) {
  // Hold a synthetic download in this temporary profile until after SW restart.
  const responses = new Set();
  const server = createServer((_request, response) => {
    responses.add(response);
    response.on("close", () => responses.delete(response));
    response.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": 1024 * 1024,
    });
    response.write(Buffer.alloc(1024));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const probe = await browserContext.newCDPSession(page);
  let downloadId;
  try {
    const url = `http://127.0.0.1:${server.address().port}/restart-probe.bin`;
    const result = await page.evaluate(async (downloadUrl) => {
      const blob = await chrome.runtime.sendMessage({
        type: "OFFSCREEN_CREATE_BLOB_URL",
        content: "offscreen restart probe",
        mimeType: "text/plain",
      });
      if (!blob.ok) throw new Error(blob.error);
      const id = await chrome.downloads.download({
        url: downloadUrl,
        filename: "restart-probe.bin",
        saveAs: false,
      });
      await chrome.downloads.pause(id);
      await chrome.storage.local.set({
        "assembly-subtitle-download-blob-urls": { [id]: blob.url },
      });
      return { id, blobUrl: blob.url };
    }, url);
    downloadId = result.id;
    await probe.send("ServiceWorker.enable");
    await probe.send("ServiceWorker.stopAllWorkers");
    const wake = await page.evaluate(() =>
      chrome.runtime.sendMessage({ type: "UPDATE_SETTINGS", settings: {} }),
    );
    assert.equal(wake.ok, true);
    assert.equal(
      await page.evaluate(
        async (url) => (await fetch(url)).text(),
        result.blobUrl,
      ),
      "offscreen restart probe",
      "The offscreen Blob must survive service worker restart",
    );
    await page.evaluate((id) => chrome.downloads.cancel(id), downloadId);
    await page.waitForFunction(async (url) => {
      try {
        await fetch(url);
        return false;
      } catch {
        return true;
      }
    }, result.blobUrl);
    const snapshot = await page.evaluate(
      async () =>
        (
          await chrome.storage.local.get("assembly-subtitle-download-blob-urls")
        )["assembly-subtitle-download-blob-urls"],
    );
    assert.equal(snapshot[result.id], undefined);
    console.log(
      "Offscreen restart: Blob survived SW stop and was revoked after cancellation.",
    );
  } finally {
    if (downloadId !== undefined)
      await page
        .evaluate((id) => chrome.downloads.cancel(id), downloadId)
        .catch(() => {});
    for (const response of responses) response.destroy();
    await new Promise((resolve) => server.close(resolve));
    await probe.detach();
  }
}

async function waitForPanelText(page, text, timeout = 15_000) {
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
        return (
          host.dataset.assemblyPanel === "1" ||
          Boolean(shadowText.includes(expectedText))
        );
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
      host.dataset.assemblyE2e = "1";
      // closed shadow: content script 가 수신하는 명령 이벤트
      host.dispatchEvent(
        new CustomEvent(commandEvent, {
          detail: { type: "click-button", label: buttonLabel },
        }),
      );
      return true;
    },
    {
      hostId: panelHostId,
      buttonLabel: label,
      commandEvent: panelCommandEvent,
    },
  );
  if (!clicked) {
    throw new Error(`Panel host not found for command: ${label}`);
  }
}

async function resolveExtensionId(browserContext) {
  let [serviceWorker] = browserContext.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await browserContext.waitForEvent("serviceworker", {
      timeout: 10_000,
    });
  }
  const url = serviceWorker.url();
  const [, extensionId] = url.match(/^chrome-extension:\/\/([^/]+)\//) ?? [];
  if (!extensionId) {
    throw new Error(
      `Unable to resolve extension id from service worker URL: ${url}`,
    );
  }
  return extensionId;
}

async function waitForDownload(page, extension, downloadedIds) {
  const deadline = Date.now() + 15_000;
  let items = [];
  while (Date.now() < deadline) {
    items = await page.evaluate(() => chrome.downloads.search({}));
    // CDP dismisses the native Save As dialog and Chromium may choose a Blob
    // UUID filename. Correlate the new Chrome download ID, not that filename.
    const item = items.find((item) => !downloadedIds.has(item.id));
    if (item?.state === "complete") return item;
    if (item?.state === "interrupted")
      throw new Error(`${extension} download interrupted: ${item.error}`);
    await delay(100);
  }
  throw new Error(
    `${extension} download did not complete: ${JSON.stringify(items)}`,
  );
}
