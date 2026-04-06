import { afterEach, describe, expect, it, vi } from "vitest";

import { OBSERVER_ACTIVATE_EVENT } from "../src/shared/constants";

type ActivationWindow = Window & {
  __assemblySubtitleActivationBridge?: boolean;
  smi_mode_act?: (value: number) => void;
  smi_on?: () => void;
  layerSubtit?: () => void;
};

describe("injected activation helper", () => {
  afterEach(() => {
    delete (window as ActivationWindow).__assemblySubtitleActivationBridge;
    delete (window as ActivationWindow).smi_mode_act;
    delete (window as ActivationWindow).smi_on;
    delete (window as ActivationWindow).layerSubtit;
    vi.restoreAllMocks();
  });

  it("invokes page subtitle activation functions when the activate event fires", async () => {
    vi.resetModules();

    const smiModeAct = vi.fn();
    (window as ActivationWindow).smi_mode_act = smiModeAct;
    await import("../src/content/injected-observer");

    window.dispatchEvent(new CustomEvent(OBSERVER_ACTIVATE_EVENT));

    expect(smiModeAct).toHaveBeenCalledWith(1);
  });

  it("falls back to the next activation candidate when the first one is unavailable", async () => {
    vi.resetModules();

    const smiOn = vi.fn();
    (window as ActivationWindow).smi_on = smiOn;
    await import("../src/content/injected-observer");

    window.dispatchEvent(new CustomEvent(OBSERVER_ACTIVATE_EVENT));

    expect(smiOn).toHaveBeenCalledTimes(1);
  });
});
