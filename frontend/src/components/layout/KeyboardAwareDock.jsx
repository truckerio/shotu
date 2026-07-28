import "./keyboard-aware-dock.css";

const DOCK_MODES = new Set(["hide", "follow"]);

export function KeyboardAwareDock({
  keyboardOpen,
  mode = "hide",
  className = "",
  children,
}) {
  const resolvedMode = DOCK_MODES.has(mode) ? mode : "hide";
  const hidden = resolvedMode === "hide" && keyboardOpen;

  return (
    <div
      className={`keyboard-aware-dock keyboard-aware-dock--${resolvedMode} ${className}`.trim()}
      data-keyboard-open={keyboardOpen ? "true" : "false"}
      data-mode={resolvedMode}
      aria-hidden={hidden ? "true" : undefined}
      inert={hidden ? true : undefined}
    >
      {children}
    </div>
  );
}
