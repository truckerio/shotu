import { Trash01, XClose } from "@untitledui/icons";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Button } from "../../components/ui/Button.jsx";
import "./workorder-drafts.css";

export function DraftDiscardDialog({
  open,
  draftLabel = "this draft",
  busy = false,
  error = "",
  onCancel,
  onDiscard,
}) {
  return (
    <ModalOverlay
      className="workorder-draft-modal-overlay"
      isOpen={open}
      isDismissable={!busy}
      onOpenChange={(isOpen) => {
        if (!isOpen && !busy) onCancel?.();
      }}
    >
      <Modal className="workorder-draft-modal">
        <Dialog className="workorder-draft-dialog" aria-label="Discard draft">
          <div className="workorder-draft-dialog-heading">
            <div>
              <Heading slot="title">Discard draft?</Heading>
              <p>{draftLabel} will be removed and cannot be resumed.</p>
            </div>
            <button className="workorder-draft-dialog-close" type="button" title="Close" aria-label="Close" onClick={onCancel} disabled={busy}>
              <XClose aria-hidden="true" />
            </button>
          </div>
          {error ? <p className="workorder-draft-dialog-error" role="alert">{error}</p> : null}
          <div className="workorder-draft-dialog-actions">
            <Button type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
            <Button type="button" variant="danger" icon={Trash01} onClick={onDiscard} disabled={busy}>
              {busy ? "Discarding" : "Discard draft"}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

