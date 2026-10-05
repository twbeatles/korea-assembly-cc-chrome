/** PANEL_STYLE 조립 — 뒤 파트가 앞 파트를 덮어쓰므로 순서를 유지한다. */
import { tokensStyle } from "./tokens";
import { shellStyle } from "./shell";
import { headerStyle } from "./header";
import { sectionsStyle } from "./sections";
import { liveStyle } from "./live";
import { controlsStyle } from "./controls";
import { responsiveStyle } from "./responsive";

export const PANEL_STYLE = `\n${[
  tokensStyle,
  shellStyle,
  headerStyle,
  sectionsStyle,
  liveStyle,
  controlsStyle,
  responsiveStyle,
].join("\n")}\n`;
