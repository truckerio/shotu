import { ArrowRight, Trash01, XClose } from "@untitledui/icons";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Button } from "../ui/Button.jsx";
import "./drafts.css";

export function DraftResumeDialog({
  open,
  busy = false,
  title = "Continue your draft?",
  description = "You have an unfinished draft saved from earlier.",
  draftLabel = "",
  updatedAt = "",
  onResume,
  onDiscard,
  onClose,
}) {
  return (
    <ModalOverlay
      className="draft-modal-overlay"
      isOpen={open}
      isDismissable={Boolean(onClose) && !busy}
      onOpenChange={(isOpen) => {
        if (!isOpen && !busy) onClose?.();
      }}
    >
      <Modal className="draft-modal">
        <Dialog className="draft-dialog" aria-label={title}>
          <div className="draft-dialog-header">
            <div>
              <Heading slot="title">{title}</Heading>
              <p>{description}</p>
            </div>
            {onClose ? (
              <button
                className="draft-dialog-close"
                type="button"
                aria-label="Close"
                title="Close"
                onClick={onClose}
                disabled={busy}
              >
                <XClose aria-hidden="true" />
              </button>
            ) : null}
          </div>

          {draftLabel || updatedAt ? (
            <div className="draft-resume-summary">
              {draftLabel ? <strong>{draftLabel}</strong> : null}
              {updatedAt ? <span>Last saved {updatedAt}</span> : null}
            </div>
          ) : null}

          <div className="draft-dialog-actions">
            <Button type="button" variant="danger" icon={Trash01} onClick={onDiscard} disabled={busy}>
              Discard draft
            </Button>
            <Button type="button" variant="primary" icon={ArrowRight} onClick={onResume} disabled={busy}>
              Continue draft
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
