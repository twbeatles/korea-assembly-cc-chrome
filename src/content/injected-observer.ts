import { OBSERVER_ACTIVATE_EVENT } from "../shared/constants";

type ActivationWindow = Window & {
  __assemblySubtitleActivationBridge?: boolean;
  __assemblySubtitleActivationHandler?: EventListener;
  smi_mode_act?: (value: number) => void;
  smi_on?: () => void;
  layerSubtit?: () => void;
};

function invokeActivation(candidate: unknown, ...args: unknown[]): boolean {
  if (typeof candidate !== "function") {
    return false;
  }

  try {
    candidate(...args);
    return true;
  } catch {
    return false;
  }
}

function activateSubtitleLayer(): void {
  const pageWindow = window as ActivationWindow;
  if (invokeActivation(pageWindow.smi_mode_act, 1)) {
    return;
  }
  if (invokeActivation(pageWindow.smi_on)) {
    return;
  }
  void invokeActivation(pageWindow.layerSubtit);
}

const pageWindow = window as ActivationWindow;
const existingHandler = pageWindow.__assemblySubtitleActivationHandler;
if (existingHandler) {
  window.removeEventListener(OBSERVER_ACTIVATE_EVENT, existingHandler);
}

if (!pageWindow.__assemblySubtitleActivationBridge || !existingHandler) {
  const handler: EventListener = () => {
    activateSubtitleLayer();
  };
  pageWindow.__assemblySubtitleActivationBridge = true;
  pageWindow.__assemblySubtitleActivationHandler = handler;
  window.addEventListener(OBSERVER_ACTIVATE_EVENT, handler);
}
