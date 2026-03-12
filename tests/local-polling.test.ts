import {
  buildLocalProbeSignature,
  shouldEmitLocalProbeUpdate,
} from "../src/content/local-polling";

describe("local polling helpers", () => {
  it("builds a stable signature from fallback text", () => {
    expect(
      buildLocalProbeSignature({
        text: "자막 내용",
      }),
    ).toBe("자막내용");
  });

  it("emits only when the local probe signature changes", () => {
    const unchanged = shouldEmitLocalProbeUpdate("자막내용", {
      text: "자막 내용",
    });
    expect(unchanged.shouldEmit).toBe(false);

    const changed = shouldEmitLocalProbeUpdate("자막내용", {
      text: "자막 내용 변경",
    });
    expect(changed.shouldEmit).toBe(true);
    expect(changed.signature).toBe("자막내용변경");
  });

  it("tracks structured row changes via row signatures", () => {
    const previous = buildLocalProbeSignature({
      text: "첫 번째 문장",
      rows: [
        {
          nodeKey: "row_1",
          text: "첫 번째 문장",
          speakerColor: "rgb(35, 124, 147)",
          speakerChannel: "primary",
          unstableKey: false,
        },
      ],
    });

    const changed = shouldEmitLocalProbeUpdate(previous, {
      text: "첫 번째 문장 수정",
      rows: [
        {
          nodeKey: "row_1",
          text: "첫 번째 문장 수정",
          speakerColor: "rgb(35, 124, 147)",
          speakerChannel: "primary",
          unstableKey: false,
        },
      ],
    });

    expect(changed.shouldEmit).toBe(true);
  });
});
