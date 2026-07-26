import { Save01, Trash01, XClose } from "@untitledui/icons";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Button } from "../ui/Button.jsx";
import { DraftSaveStatus } from "./DraftSaveStatus.jsx";
import "./drafts.css";

export function DraftLeaveDialog({
  open,
  busy = false,
  status = "dirty",
  error = null,
  title = "Leave this draft?",
  description = "Save your changes so you can continue later, or discard them permanently.",
  onStay,
  onDiscard,
  onSaveAndLeave,
}) {
  return (
    <ModalOverlay
      className="draft-modal-overlay"
      isOpen={open}
      isDismissable={Boolean(onStay) && !busy}
      onOpenChange={(isOpen) => {
        if (!isOpen && !busy) onStay?.();
      }}
    >
      <Modal className="draft-modal">
        <Dialog className="draft-dialog" aria-label={title}>
          <div className="draft-dialog-header">
            <div>
              <Heading slot="title">{title}</Heading>
              <p>{description}</p>
            </div>
            <button
              className="draft-dialog-close"
              type="button"
              aria-label="Keep editing"
              title="Keep editing"
              onClick={onStay}
              disabled={busy}
            >
              <XClose aria-hidden="true" />
            </button>
          </div>

          <DraftSaveStatus status={status} error={error} />

          <div className="draft-dialog-actions">
            <Button type="button" variant="secondary" onClick={onStay} disabled={busy}>
              Keep editing
            </Button>
            <Button type="button" variant="danger" icon={Trash01} onClick={onDiscard} disabled={busy}>
              Discard draft
            </Button>
            <Button type="button" variant="primary" icon={Save01} onClick={onSaveAndLeave} disabled={busy}>
              {status === "saving" ? "Saving..." : "Save draft and leave"}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
