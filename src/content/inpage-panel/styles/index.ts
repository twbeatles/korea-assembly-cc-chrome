/** PANEL_STYLE 조립 — 파트 순서 변경 금지 (원본과 바이트 동일 유지). */
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
