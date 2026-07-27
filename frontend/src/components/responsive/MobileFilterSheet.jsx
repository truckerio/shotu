import { XClose } from "@untitledui/icons";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import "./mobile-filter-sheet.css";

export function MobileFilterSheet({
  open,
  onOpenChange,
  title = "Filters",
  children,
  footer = null,
}) {
  return (
    <ModalOverlay
      className="mobile-filter-overlay"
      isOpen={open}
      onOpenChange={onOpenChange}
      isDismissable
    >
      <Modal className="mobile-filter-modal">
        <Dialog className="mobile-filter-dialog" aria-label={title}>
          {({ close }) => (
            <>
              <header>
                <Heading slot="title">{title}</Heading>
                <button type="button" onClick={close} aria-label={`Close ${title.toLowerCase()}`}>
                  <XClose />
                </button>
              </header>
              <div className="mobile-filter-content">{children}</div>
              {footer ? <footer>{footer}</footer> : null}
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
