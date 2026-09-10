import { useState } from "react";
import { Settings01, XClose } from "@untitledui/icons";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Button } from "../../components/ui/Button.jsx";
import { Checkbox } from "../../components/ui/Checkbox.jsx";
import { api } from "../../lib/api.js";

function stockRuleDraft(location) {
  return {
    minimum: location.minimumAvailable ?? "",
    target: location.targetQuantity ?? "",
    enabled: location.policyVersion ? location.alertEnabled !== false : true,
  };
}

export function PartLocationSettings({ part, location, disabled = false, onSaved }) {
  const [open, setOpen] = useState(false);
  const [rule, setRule] = useState(() => stockRuleDraft(location));
  const [ruleBusy, setRuleBusy] = useState(false);
  const [ruleMessage, setRuleMessage] = useState("");

  function showSettings() {
    setRule(stockRuleDraft(location));
    setRuleMessage("");
    setOpen(true);
  }

  async function saveRule() {
    const minimumAvailable = Number(rule.minimum);
    const targetQuantity = rule.target === "" ? null : Number(rule.target);
    if (!Number.isFinite(minimumAvailable) || minimumAvailable < 0 || (targetQuantity !== null && targetQuantity < minimumAvailable)) {
      setRuleMessage("Enter a minimum of zero or more. Target must be at least the minimum.");
      return;
    }
    setRuleBusy(true);
    setRuleMessage("");
    try {
      await api(`/api/office/inventory/parts/${encodeURIComponent(part.catalogPartId)}/stock-rule`, {
        method: "PATCH",
        body: JSON.stringify({
          locationId: location.locationId,
          expectedVersion: location.policyVersion ?? null,
          minimumAvailable,
          targetQuantity,
          alertEnabled: rule.enabled,
        }),
      });
      setRuleMessage(`Stock rule saved for ${location.locationName}.`);
      onSaved?.();
    } catch (error) {
      setRuleMessage(error.message || "Stock rule could not be saved.");
    } finally {
      setRuleBusy(false);
    }
  }

  const busy = ruleBusy;
  return <>
    <Button type="button" icon={Settings01} aria-label={`Stock settings for ${location.locationName}`} onClick={showSettings} disabled={disabled} />
    {open ? <ModalOverlay className="inventory-location-settings-overlay" isOpen isDismissable={!busy} onOpenChange={(nextOpen) => { if (!nextOpen && !busy) setOpen(false); }}>
      <Modal className="inventory-location-settings-modal">
        <Dialog className="inventory-location-settings-dialog" aria-label={`${location.locationName} inventory settings`}>
          <header><div><Heading slot="title">{location.locationName} settings</Heading><p>{part.partNumber} · {part.description || "No part name"}</p></div><button type="button" aria-label="Close location settings" onClick={() => setOpen(false)} disabled={busy}><XClose aria-hidden="true" /></button></header>

          <section aria-labelledby={`stock-rule-${location.locationId}`}>
            <div><h3 id={`stock-rule-${location.locationId}`}>Stock rule</h3><p>These thresholds apply only to {location.locationName}.</p></div>
            {ruleMessage ? <p className="inventory-location-settings-message" role="status">{ruleMessage}</p> : null}
            <div className="inventory-stock-rule-form">
              <label><span>Minimum available</span><input type="number" min="0" step="any" value={rule.minimum} onChange={(event) => setRule((value) => ({ ...value, minimum: event.target.value }))} disabled={busy} /></label>
              <label><span>Target quantity</span><input type="number" min="0" step="any" placeholder="Optional" value={rule.target} onChange={(event) => setRule((value) => ({ ...value, target: event.target.value }))} disabled={busy} /></label>
              <label className="inventory-stock-rule-toggle"><Checkbox checked={rule.enabled} onChange={(event) => setRule((value) => ({ ...value, enabled: event.target.checked }))} disabled={busy} /><span>Notify Office when minimum is reached</span></label>
            </div>
            <div className="inventory-location-settings-actions"><Button type="button" variant="primary" onClick={saveRule} disabled={busy}>{ruleBusy ? "Saving…" : "Save stock rule"}</Button></div>
          </section>

          <footer><Button type="button" onClick={() => setOpen(false)} disabled={busy}>Close</Button></footer>
        </Dialog>
      </Modal>
    </ModalOverlay> : null}
  </>;
}
