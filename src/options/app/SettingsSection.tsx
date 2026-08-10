import type { ReactNode } from "react";

export function SettingsSection(props: {
  title: string;
  lead?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`settings-section ${props.className ?? ""}`.trim()}>
      <header className="settings-section-header">
        <h2 className="settings-section-title">{props.title}</h2>
        {props.lead ? <p className="settings-section-lead">{props.lead}</p> : null}
      </header>
      <div className="settings-section-body settings-grid">{props.children}</div>
    </section>
  );
}
