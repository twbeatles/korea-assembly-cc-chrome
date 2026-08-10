export function SettingToggleCard(props: {
  title: string;
  description: string;
  caution?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  fullWidth?: boolean;
}) {
  return (
    <label className={`setting-card${props.fullWidth ? " full-width" : ""}`}>
      <div>
        <strong>{props.title}</strong>
        <span>{props.description}</span>
        {props.caution ? <span className="setting-caution">{props.caution}</span> : null}
      </div>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
      />
    </label>
  );
}
