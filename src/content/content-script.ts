import { CONTENT_SCRIPT_BOOTSTRAP_ATTRIBUTE } from "./app/context";
import { createContentRuntime } from "./app/runtime";

const runtime = createContentRuntime();
const bootstrapRoot = document.documentElement;

if (!bootstrapRoot?.hasAttribute(CONTENT_SCRIPT_BOOTSTRAP_ATTRIBUTE)) {
  bootstrapRoot?.setAttribute(CONTENT_SCRIPT_BOOTSTRAP_ATTRIBUTE, "true");
  void runtime.bootstrap().catch((error: unknown) => {
    runtime.handleBootstrapError(error);
  });
}
