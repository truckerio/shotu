import { useId } from "react";
import { UploadCloud02, XClose } from "@untitledui/icons";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import "./upload-dialog.css";

export function UploadDialog({
  actions = null,
  children,
  closeDisabled = false,
  closeLabel,
  description = "",
  error = "",
  footer = null,
  isDismissable = true,
  isOpen,
  onOpenChange,
  status = "",
  title,
}) {
  const titleId = useId();

  return (
    <ModalOverlay
      className="shared-upload-overlay"
      isOpen={isOpen}
      isDismissable={isDismissable}
      onOpenChange={onOpenChange}
    >
      <Modal className="shared-upload-modal">
        <Dialog className="shared-upload-dialog" aria-labelledby={titleId}>
          <div className="shared-upload-heading">
            <div>
              <Heading slot="title" id={titleId}>{title}</Heading>
              {description ? <p>{description}</p> : null}
            </div>
            <button type="button" aria-label={closeLabel} onClick={() => onOpenChange?.(false)} disabled={closeDisabled}>
              <XClose aria-hidden="true" />
            </button>
          </div>
          <div className="shared-upload-body">{children}</div>
          {actions ? <div className="shared-upload-actions">{actions}</div> : null}
          {error ? <p className="ops-error shared-upload-feedback" role="alert" aria-live="assertive">{error}</p> : null}
          {status ? <p className="shared-upload-status" role="status">{status}</p> : null}
          {footer ? <div className="shared-upload-footer">{footer}</div> : null}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

export function UploadDropzone({
  accept,
  disabled = false,
  hint = "",
  inputId,
  inputRef,
  multiple = false,
  onChange,
  onDrop,
  required = false,
  text,
}) {
  return (
    <>
      <input
        ref={inputRef}
        id={inputId}
        className="shared-upload-native-input"
        type="file"
        accept={accept}
        multiple={multiple}
        required={required}
        disabled={disabled}
        onChange={onChange}
      />
      <label
        className={`shared-upload-dropzone${disabled ? " is-disabled" : ""}`}
        htmlFor={inputId}
        aria-disabled={disabled || undefined}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (!disabled) onDrop?.(event);
        }}
      >
        <span className="shared-upload-dropzone-icon"><UploadCloud02 aria-hidden="true" /></span>
        <span className="shared-upload-dropzone-copy">
          <strong>{text}</strong>
          {hint ? <small>{hint}</small> : null}
        </span>
      </label>
    </>
  );
}
