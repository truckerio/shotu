import { XClose } from "@untitledui/icons";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import "./secondary-detail-panel.css";

export function SecondaryDetailPanel({
  open,
  onOpenChange,
  eyebrow = "Details",
  title,
  description = "",
  status = null,
  children,
  footer = null,
  size = "wide",
  dismissable = true,
  closeLabel = "Close details",
}) {
  return (
    <ModalOverlay
      className="secondary-detail-overlay"
      isOpen={open}
      isDismissable={dismissable}
      onOpenChange={onOpenChange}
    >
      <Modal className={`secondary-detail-modal is-${size}`}>
        <Dialog className="secondary-detail-dialog" aria-label={title}>
          {({ close }) => (
            <>
              <header className="secondary-detail-header">
                <div className="secondary-detail-heading">
                  <span className="secondary-detail-eyebrow">{eyebrow}</span>
                  <div className="secondary-detail-title-row">
                    <Heading slot="title">{title}</Heading>
                    {status}
                  </div>
                  {description ? <p>{description}</p> : null}
                </div>
                <button type="button" onClick={close} aria-label={closeLabel} title={closeLabel}>
                  <XClose aria-hidden="true" />
                </button>
              </header>
              <div className="secondary-detail-content">{children}</div>
              {footer ? <footer className="secondary-detail-footer">{footer}</footer> : null}
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

export function SecondaryDetailSection({ title, description = "", action = null, children, className = "" }) {
  return (
    <section className={`secondary-detail-section ${className}`.trim()}>
      <header>
        <div>
          <h3>{title}</h3>
          {description ? <p>{description}</p> : null}
        </div>
        {action}
      </header>
      <div className="secondary-detail-section-body">{children}</div>
    </section>
  );
}
