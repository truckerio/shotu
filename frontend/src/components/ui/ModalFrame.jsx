import { Dialog, Modal, ModalOverlay } from "react-aria-components";

export function ModalFrame({
  ariaDescribedBy,
  ariaLabel,
  ariaLabelledBy,
  children,
  dialogClassName = "",
  isDismissable = true,
  isOpen = true,
  modalClassName = "",
  onKeyDown,
  onOpenChange,
  overlayClassName = "",
}) {
  return (
    <ModalOverlay
      className={overlayClassName}
      isOpen={isOpen}
      isDismissable={isDismissable}
      onOpenChange={onOpenChange}
    >
      <Modal className={modalClassName}>
        <Dialog
          className={dialogClassName}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          onKeyDown={onKeyDown}
        >
          {children}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
