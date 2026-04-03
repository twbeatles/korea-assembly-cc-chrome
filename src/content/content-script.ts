import { bootstrapContentScript } from "./bootstrap/bootstrap-content-script";

const CONTENT_SCRIPT_BOOTSTRAP_ATTRIBUTE = "data-assembly-subtitle-content-script";
const bootstrapRoot = document.documentElement;

if (!bootstrapRoot?.hasAttribute(CONTENT_SCRIPT_BOOTSTRAP_ATTRIBUTE)) {
  bootstrapRoot?.setAttribute(CONTENT_SCRIPT_BOOTSTRAP_ATTRIBUTE, "true");
  void bootstrapContentScript();
}
