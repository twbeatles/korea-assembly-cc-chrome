import { describe, expect, it } from "vitest";

import {
  getSubtitleSelectorCandidates,
  isElementActuallyVisible,
  resolveSubtitleSelectorProfile,
} from "../src/content/subtitle-dom";

function mountElement(
  html: string,
  options: {
    width?: number;
    height?: number;
  } = {},
): HTMLElement {
  document.body.innerHTML = html;
  const element = document.body.firstElementChild as HTMLElement;
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () =>
      ({
        width: options.width ?? 120,
        height: options.height ?? 32,
        top: 0,
        left: 0,
        bottom: options.height ?? 32,
        right: options.width ?? 120,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) satisfies DOMRect,
  });
  return element;
}

describe("subtitle dom helpers", () => {
  it("treats only sized visible elements as visible", () => {
    const visible = mountElement(`<div style="display:block; visibility:visible; opacity:1"></div>`);
    expect(isElementActuallyVisible(visible)).toBe(true);

    const hidden = mountElement(`<div hidden style="display:block; visibility:visible; opacity:1"></div>`);
    expect(isElementActuallyVisible(hidden)).toBe(false);

    const displayNone = mountElement(`<div style="display:none; visibility:visible; opacity:1"></div>`);
    expect(isElementActuallyVisible(displayNone)).toBe(false);

    const visibilityHidden = mountElement(
      `<div style="display:block; visibility:hidden; opacity:1"></div>`,
    );
    expect(isElementActuallyVisible(visibilityHidden)).toBe(false);

    const transparent = mountElement(`<div style="display:block; visibility:visible; opacity:0"></div>`);
    expect(isElementActuallyVisible(transparent)).toBe(false);

    const zeroSize = mountElement(`<div style="display:block; visibility:visible; opacity:1"></div>`, {
      width: 0,
      height: 0,
    });
    expect(isElementActuallyVisible(zeroSize)).toBe(false);
  });

  it("resolves plenary and default selector profiles from the source URL", () => {
    expect(resolveSubtitleSelectorProfile(undefined).id).toBe("default");
    expect(
      resolveSubtitleSelectorProfile(
        "https://assembly.webcast.go.kr/main/player.asp?xcode=10&xcgcd=DCM000010224330202",
      ).id,
    ).toBe("plenary");
    expect(
      resolveSubtitleSelectorProfile(
        "https://assembly.webcast.go.kr/main/player.asp?xcode=25&xcgcd=DCM000025224330202",
      ).id,
    ).toBe("committee");
  });

  it("keeps the preferred selector ahead of the profile defaults", () => {
    const selectors = getSubtitleSelectorCandidates(
      ".custom_subtitle",
      ["#viewSubtit", ".custom_subtitle"],
      "https://assembly.webcast.go.kr/main/player.asp?xcode=25",
    );

    expect(selectors[0]).toBe(".custom_subtitle");
    expect(selectors).toContain("#viewSubtit .smi_word");
  });
});
