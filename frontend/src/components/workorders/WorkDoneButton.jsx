import { CheckCircle } from "@untitledui/icons";
import { Button } from "../ui/Button.jsx";

export function WorkDoneButton({
  busy = false,
  busyLabel = "Submitting",
  className = "",
  disabled = false,
  label = "Work done",
  ...props
}) {
  return (
    <Button
      className={`work-done-button ${className}`.trim()}
      variant="primary"
      icon={CheckCircle}
      disabled={disabled || busy}
      {...props}
    >
      {busy ? busyLabel : label}
    </Button>
  );
}
