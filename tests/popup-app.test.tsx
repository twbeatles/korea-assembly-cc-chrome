import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const chromeApiMocks = vi.hoisted(() => ({
  connectToTab: vi.fn(),
  queryActiveTab: vi.fn(),
  sendRuntimeMessage: vi.fn(),
}));

vi.mock("../src/shared/chrome-api", () => chromeApiMocks);

import App from "../src/popup/App";

describe("popup app", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chromeApiMocks.queryActiveTab.mockResolvedValue({
      id: 1,
      url: "https://example.com/",
    });
  });

  it("shows a user-facing error when opening history fails", async () => {
    chromeApiMocks.sendRuntimeMessage.mockRejectedValueOnce(new Error("history failed"));

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "저장된 기록" }));

    await waitFor(() => {
      expect(screen.getByText("history failed")).toBeTruthy();
    });
  });

  it("shows a user-facing error when opening options fails", async () => {
    chromeApiMocks.sendRuntimeMessage.mockRejectedValueOnce(new Error("options failed"));

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "환경 설정" }));

    await waitFor(() => {
      expect(screen.getByText("options failed")).toBeTruthy();
    });
  });

  it("shows a user-facing error when opening diagnostics fails", async () => {
    chromeApiMocks.sendRuntimeMessage.mockRejectedValueOnce(new Error("diagnostics failed"));

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "수집 진단" }));

    await waitFor(() => {
      expect(screen.getByText("diagnostics failed")).toBeTruthy();
    });
  });
});
