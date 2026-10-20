import { useRef, useState } from "react";
import { Heading } from "react-aria-components";
import { interfaceText } from "../../i18n/index.js";
import { ModalFrame } from "../ui/ModalFrame.jsx";
import { Button } from "../ui/Button.jsx";
import "./work-done-confirmation-dialog.css";

export function WorkDoneConfirmationDialog({ locale = "en", busy = false, message = "", onCancel, onConfirm }) {
  const t = (key) => interfaceText(locale, key);
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const locked = busy || submitting;
  async function submit(event) {
    event.preventDefault();
    if (locked || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true); setFailed(false);
    try { if (!await onConfirm()) setFailed(true); }
    catch { setFailed(true); }
    finally { inFlight.current = false; setSubmitting(false); }
  }
  return <ModalFrame ariaLabel={t("completion.installedTitle")} overlayClassName="work-done-confirm-overlay"
    modalClassName="work-done-confirm-modal" dialogClassName="work-done-confirm-dialog"
    isDismissable={!locked} onOpenChange={(open) => { if (!open && !locked) onCancel(); }}>
    <form onSubmit={submit}>
      <Heading slot="title">{t("completion.installedTitle")}</Heading>
      <p>{t("completion.installedCopy")}</p>
      {failed ? <p role="alert">{message || t("completion.submitFailed")}</p> : null}
      <footer>
        <Button type="button" variant="secondary" autoFocus disabled={locked} onClick={onCancel}>{t("completion.notInstalled")}</Button>
        <Button type="submit" variant="primary" disabled={locked}>{locked ? t("completion.submitting") : t("completion.confirmInstalled")}</Button>
      </footer>
    </form>
  </ModalFrame>;
}
