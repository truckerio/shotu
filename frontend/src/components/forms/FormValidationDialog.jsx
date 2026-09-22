import { useState } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { Button } from '../ui/Button.jsx';
import { normalizeFormErrors } from './form-utils.js';
import './form-validation-dialog.css';

export function FormValidationDialog({ errors, focusKey = 0, focusReady = true, onFocusTarget, title }) {
  const [dismissedAttempt, setDismissedAttempt] = useState(null);
  const items = normalizeFormErrors(errors);
  const open = items.length > 0 && dismissedAttempt !== focusKey;
  function close() {
    setDismissedAttempt(focusKey);
    if (!focusReady) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const field = document.getElementById(items[0]?.id);
      if (!field) return;
      field.focus({ preventScroll: true });
      if (!onFocusTarget?.(field)) field.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }));
  }
  return <ModalOverlay className="form-validation-overlay" isOpen={open} isDismissable onOpenChange={value => { if (!value) close(); }}>
    <Modal className="form-validation-modal">
      <Dialog className="form-validation-dialog" aria-label={title}>
        <Heading slot="title">{title}</Heading>
        <ul>{items.map(item => <li key={item.key}>{item.message}</li>)}</ul>
        <footer><Button variant="primary" onClick={close}>Review fields</Button></footer>
      </Dialog>
    </Modal>
  </ModalOverlay>;
}
