import { AlertCircle, XClose } from '@untitledui/icons';
import { Heading } from 'react-aria-components';
import { Button } from '../../components/ui/Button.jsx';
import { IconButton } from '../../components/ui/IconButton.jsx';
import { ModalFrame } from '../../components/ui/ModalFrame.jsx';

export function PurchaseOrderFeedbackDialog({ feedback, onClose }) {
  return <ModalFrame overlayClassName="purchase-feedback-overlay" modalClassName="purchase-feedback-modal" dialogClassName="purchase-feedback-dialog" ariaLabel={feedback?.title} isOpen={!!feedback} isDismissable onOpenChange={open => { if (!open) onClose(); }}>
        <header><span className="purchase-feedback-icon"><AlertCircle aria-hidden="true" /></span><Heading slot="title">{feedback?.title}</Heading><IconButton icon={XClose} label="Close message" onClick={onClose} /></header>
        <ul>{feedback?.issues.map((issue, index) => <li key={`${issue.field}:${index}`}>{issue.message}</li>)}</ul>
        <footer><Button variant="primary" onClick={onClose}>{feedback?.validation ? 'Review fields' : 'Got it'}</Button></footer>
  </ModalFrame>;
}
