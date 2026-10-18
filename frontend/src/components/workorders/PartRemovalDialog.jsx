import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Button } from "../ui/Button.jsx";
import { interfaceText } from "../../i18n/index.js";

export function PartRemovalDialog({ saved, busy, error, locale, onCancel, onRemove }) {
  const t = (key) => interfaceText(locale, key);
  return <ModalOverlay className="measured-part-dialog-overlay" isOpen isDismissable={!busy} onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
    <Modal className="measured-part-dialog-modal">
      <Dialog className="measured-part-dialog" aria-label={t("parts.removePartRow")}>
        <Heading slot="title">{t("parts.removePartRow")}</Heading>
        <p>{t(saved ? "parts.removeSavedConfirm" : "parts.removeDraftConfirm")}</p>
        {error ? <p role="alert">{error}</p> : null}
        <footer>
          <Button type="button" onClick={onCancel} disabled={busy} autoFocus>{t("parts.cancel")}</Button>
          <Button type="button" variant="danger" onClick={onRemove} disabled={busy}>{busy ? t("parts.removing") : t("parts.remove")}</Button>
        </footer>
      </Dialog>
    </Modal>
  </ModalOverlay>;
}
