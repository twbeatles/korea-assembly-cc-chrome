import type { ReactNode } from "react";

export function SettingInputCard(props: {
  title: string;
  description: string;
  error?: string;
  fullWidth?: boolean;
  children: ReactNode;
  /** 접근성 이름 — 내부 input 에 연결할 때 사용 */
  htmlFor?: string;
}) {
  return (
    <label
      className={`setting-card input-card${props.fullWidth ? " full-width" : ""}${
        props.error ? " has-error" : ""
      }`}
      htmlFor={props.htmlFor}
    >
      <div>
        <strong>{props.title}</strong>
        <span>{props.description}</span>
      </div>
      <div className="number-input-group">
        {props.children}
        {props.error ? <span className="field-error">{props.error}</span> : null}
      </div>
    </label>
  );
}
