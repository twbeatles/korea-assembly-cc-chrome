import { describe, expect, it } from "vitest";

import {
  PRIMARY_SPEAKER_COLOR,
  buildObservedSubtitlePreview,
  countFilteredUnconfirmedSubtitleRows,
  readObservedSubtitleRows,
} from "../src/content/subtitle-rows";

describe("subtitle row helpers", () => {
  it("reads stable smi_word rows and classifies the reference speaker color", () => {
    document.body.innerHTML = `
      <div id="viewSubtit">
        <div class="smi_word row_1"><span style="color: #237c93">첫 번째 자막</span></div>
        <div class="smi_word row_2"><span style="color: #1e1e1e">두 번째 자막</span></div>
      </div>
    `;

    const rows = readObservedSubtitleRows(document);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      nodeKey: "class:row_1",
      nodeKeySource: "class",
      speakerColor: PRIMARY_SPEAKER_COLOR,
      speakerChannel: "primary",
      unstableKey: false,
    });
    expect(rows[1].speakerChannel).toBe("secondary");
  });

  it("marks rows without a stable class token as unstable and assigns a generated row key", () => {
    document.body.innerHTML = `
      <div id="viewSubtit">
        <div class="smi_word"><span>클래스 키가 없는 자막</span></div>
      </div>
    `;

    const rows = readObservedSubtitleRows(document);

    expect(rows).toHaveLength(1);
    expect(rows[0].unstableKey).toBe(true);
    expect(rows[0].nodeKeySource).toBe("generated");
    expect(rows[0].nodeKey).toContain("row_");
  });

  it("splits one smi_word into multiple rows when child spans use different speaker colors", () => {
    document.body.innerHTML = `
      <div id="viewSubtit">
        <div class="smi_word row_multi">
          <span id="spk_a">발언자 A 구간</span>
          <span id="spk_b">발언자 B 구간</span>
        </div>
      </div>
    `;

    // jsdom 은 getComputedStyle color 를 비울 수 있어 span id / style 기준으로 mock 한다.
    const originalGetComputedStyle = window.getComputedStyle.bind(window);
    const resolveMockColor = (element: Element): string => {
      const id = (element as HTMLElement).id;
      if (id === "spk_a") {
        return "rgb(35, 124, 147)";
      }
      if (id === "spk_b") {
        return "rgb(30, 30, 30)";
      }
      const inline = String((element as HTMLElement).style?.color || "").toLowerCase();
      if (inline.includes("35, 124, 147") || inline.includes("#237c93")) {
        return "rgb(35, 124, 147)";
      }
      if (inline.includes("30, 30, 30") || inline.includes("#1e1e1e")) {
        return "rgb(30, 30, 30)";
      }
      return originalGetComputedStyle(element).color;
    };
    window.getComputedStyle = ((element: Element) => {
      const style = originalGetComputedStyle(element);
      const color = resolveMockColor(element);
      return new Proxy(style, {
        get(target, prop, receiver) {
          if (prop === "color") {
            return color;
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as CSSStyleDeclaration;
    }) as typeof window.getComputedStyle;

    try {
      const rows = readObservedSubtitleRows(document);
      expect(rows).toHaveLength(2);
      expect(rows[0].nodeKey).toBe("class:row_multi#spk_a");
      expect(rows[1].nodeKey).toBe("class:row_multi#spk_b");
      expect(rows[0].speakerChannel).toBe("primary");
      expect(rows[1].speakerChannel).toBe("secondary");
    } finally {
      window.getComputedStyle = originalGetComputedStyle;
    }
  });

  it("builds a preview string from the latest visible rows", () => {
    document.body.innerHTML = `
      <div id="viewSubtit">
        <div class="smi_word row_1"><span>첫 줄</span></div>
        <div class="smi_word row_2"><span>둘째 줄</span></div>
        <div class="smi_word row_3"><span>셋째 줄</span></div>
        <div class="smi_word row_4"><span>넷째 줄</span></div>
      </div>
    `;

    const rows = readObservedSubtitleRows(document);

    expect(buildObservedSubtitlePreview(rows)).toBe("둘째 줄 셋째 줄 넷째 줄");
  });

  it("splits a single smi_word into multiple rows when nested spans use different speaker colors", () => {
    document.body.innerHTML = `
      <div id="viewSubtit">
        <div class="smi_word stxt1">
          <span id="segarr_1_0" style="color: #1e1e1e">위원장 발언입니다.</span>
          <span id="segarr_1_1" style="color: #237c93">의원 발언입니다.</span>
        </div>
      </div>
    `;

    const rows = readObservedSubtitleRows(document);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      nodeKey: "class:stxt1#segarr_1_0",
      text: "위원장 발언입니다.",
      speakerChannel: "secondary",
    });
    expect(rows[1]).toMatchObject({
      nodeKey: "class:stxt1#segarr_1_1",
      text: "의원 발언입니다.",
      speakerChannel: "primary",
    });
  });

  it("filters rows whose in-progress highlight is expressed as a background image", () => {
    document.body.innerHTML = `
      <div id="viewSubtit">
        <div class="smi_word row_1">
          <span style="background-image: linear-gradient(rgb(173, 216, 230), rgb(173, 216, 230));">
            인식 중 자막
          </span>
        </div>
      </div>
    `;

    const rows = readObservedSubtitleRows(document, "#viewSubtit .smi_word", {
      filterUnconfirmedEnabled: true,
    });

    expect(rows).toHaveLength(0);
    expect(countFilteredUnconfirmedSubtitleRows(document)).toBe(1);
  });

  it("still treats deep trees with terminal highlight as unconfirmed", () => {
    const wrappers = Array.from({ length: 120 }, (_value, index) => {
      if (index === 119) {
        return `<span class="leaf" style="background-color: rgba(135, 206, 250, 0.8);">인식 중 깊은 자막</span>`;
      }
      return `<span class="nest-${index}">`;
    }).join("");
    const closers = Array.from({ length: 119 }, () => "</span>").join("");

    document.body.innerHTML = `
      <div id="viewSubtit">
        <div class="smi_word row_deep">${wrappers}${closers}</div>
      </div>
    `;

    const rows = readObservedSubtitleRows(document, "#viewSubtit .smi_word", {
      filterUnconfirmedEnabled: true,
    });

    expect(rows).toHaveLength(0);
    expect(countFilteredUnconfirmedSubtitleRows(document)).toBe(1);
  });
});
