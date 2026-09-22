import { useState } from "react";
import { Scan, XClose } from "@untitledui/icons";
import { isApplicationOwnedInventoryProvider } from "../../../../../shared/inventory-provider.js";
import { Button } from "../../../components/ui/Button.jsx";
import { IconButton } from "../../../components/ui/IconButton.jsx";
import { ModalFrame } from "../../../components/ui/ModalFrame.jsx";
import { InventoryCodeScanner } from "../../inventory/InventoryCodeScanner.jsx";
import { interfaceText } from "../../../i18n/index.js";
import { api } from "../../../lib/api.js";
import "../../../components/workorders/part-requests/mechanic-serialized-parts.css";

export function CreatePartScanner({ disabled = false, locationId, locale = "en", onScanned }) {
  const t = (key) => interfaceText(locale, key);
  const [open, setOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [message, setMessage] = useState("");

  function openScanner() {
    setMessage("");
    if (!locationId) {
      setMessage(t("create.parts.scanSelectLocation"));
      return;
    }
    setResetKey((value) => value + 1);
    setOpen(true);
  }

  function closeScanner() {
    setOpen(false);
    setResetKey((value) => value + 1);
  }

  async function resolve(code) {
    const result = await api("/api/inventory/resolve", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    const unit = result.unit;
    if (!unit || !isApplicationOwnedInventoryProvider(unit.receipt?.provider)) {
      throw new Error(t("create.parts.scanExternal"));
    }
    if (unit.locationId !== locationId) throw new Error(t("create.parts.scanWrongLocation"));
    if (unit.status !== "in_stock") throw new Error(t("create.parts.scanUnavailable"));
    onScanned(unit);
    setMessage(t("create.parts.scanAdded"));
    closeScanner();
  }

  return (
    <>
      <Button type="button" className="create-parts-compact-action" icon={Scan} onClick={openScanner} disabled={disabled}>
        {t("create.parts.scan")}
      </Button>
      {open ? (
        <ModalFrame
          overlayClassName="mechanic-scanner-overlay"
          modalClassName="mechanic-scanner-modal"
          dialogClassName="mechanic-scanner-panel"
          ariaLabel={t("create.parts.scan")}
          isOpen={open}
          isDismissable
          onOpenChange={(nextOpen) => { if (!nextOpen) closeScanner(); }}
        >
              <header className="mechanic-scanner-header">
                <IconButton className="mechanic-scanner-close" icon={XClose} label={t("parts.closeScanner")} onClick={closeScanner} />
              </header>
              <InventoryCodeScanner
                autoStart
                resetKey={`create-part:${resetKey}`}
                onScan={resolve}
                locale={locale}
                labels={{
                  cameraLabel: t("parts.scannerCamera"),
                }}
              />
        </ModalFrame>
      ) : null}
      {message ? <p className="create-parts-action-message" role="status">{message}</p> : null}
    </>
  );
}
