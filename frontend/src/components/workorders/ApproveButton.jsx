import { CheckCircle } from "@untitledui/icons";
import { Button } from "../ui/Button.jsx";

export function ApproveButton({
  busy = false,
  busyLabel = "Approving...",
  className = "",
  disabled = false,
  label = "Approve",
  ...props
}) {
  return (
    <Button
      className={`approve-button ${className}`.trim()}
      variant="success"
      icon={CheckCircle}
      disabled={disabled || busy}
      {...props}
    >
      {busy ? busyLabel : label}
    </Button>
  );
}
