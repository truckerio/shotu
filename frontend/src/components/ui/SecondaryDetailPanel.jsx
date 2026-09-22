import { XClose } from "@untitledui/icons";
import { Heading } from "react-aria-components";
import { IconButton } from "./IconButton.jsx";
import { ModalFrame } from "./ModalFrame.jsx";
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
  onClose = null,
  closeDisabled = false,
  closeLabel = "Close details",
}) {
  return (
    <ModalFrame
      overlayClassName="secondary-detail-overlay"
      modalClassName={`secondary-detail-modal is-${size}`}
      dialogClassName="secondary-detail-dialog"
      ariaLabel={title}
      isOpen={open}
      isDismissable={dismissable}
      onOpenChange={onOpenChange}
    >
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
                <IconButton icon={XClose} label={closeLabel} onClick={() => onClose ? onClose() : close()} disabled={closeDisabled} />
              </header>
              <div className="secondary-detail-content">{children}</div>
              {footer ? <footer className="secondary-detail-footer">{footer}</footer> : null}
            </>
          )}
    </ModalFrame>
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
