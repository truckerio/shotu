import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../../../lib/api.js";
import { StockIntakeControl } from "../../../components/inventory/StockIntakeControl.jsx";
import { serializedPickerPlacement } from "../../../components/workorders/part-requests/serialized-picker-placement.js";

export function CreateStockDropdown({ locationId, part, onClose }) {
  const rootRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [placement, setPlacement] = useState({ side: "below", maxHeight: 280 });
  useEffect(() => {
    let active = true;
    setData(null); setError("");
    api(`/api/office/inventory/parts/${encodeURIComponent(part.catalogPartId)}/locations/${encodeURIComponent(locationId)}/units`)
      .then((result) => { if (active) setData(result); })
      .catch((next) => { if (active) setError(next.message); });
    return () => { active = false; };
  }, [part.catalogPartId, locationId, revision]);
  useEffect(() => {
    function outside(event) {
      if (!rootRef.current?.contains(event.target) && !event.target.closest?.(".stock-intake-overlay")) onCloseRef.current?.();
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  useLayoutEffect(() => {
    function measure() {
      const root = rootRef.current;
      if (!root) return;
      setPlacement(serializedPickerPlacement({ anchorRect: root.parentElement.getBoundingClientRect(), pickerHeight: root.scrollHeight, viewportHeight: window.visualViewport?.height || window.innerHeight, viewportOffsetTop: window.visualViewport?.offsetTop || 0 }));
    }
    measure(); window.addEventListener("resize", measure); window.addEventListener("scroll", measure, true);
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [data, error]);
  const uom = data?.part.canonicalUomCode || part.uomCode;
  return <div ref={rootRef} className="create-stock-dropdown" role="dialog" aria-label={`Stock for ${part.partNo}`} style={{ top: placement.side === "above" ? "auto" : "calc(100% + 6px)", bottom: placement.side === "above" ? "calc(100% + 6px)" : "auto", maxHeight: placement.maxHeight }} onKeyDown={(event) => {
    if (event.key === "Escape" && !event.target.closest?.(".stock-intake-overlay")) { event.preventDefault(); event.stopPropagation(); onClose?.(); }
  }}>
    {error ? <p role="alert">{error}</p> : !data ? <p role="status">Loading stock…</p> : <>
      <strong>{data.location.locationName}</strong>
      <p>{Math.max(0, data.location.localQuantityOnHand - data.location.localQuantityReserved)} {uom} available</p>
      <StockIntakeControl catalogPartId={part.catalogPartId} locationId={locationId} initialData={data} onReceived={() => setRevision((value) => value + 1)} />
      {!data.part.trackingMode ? <p>Review tracking in Inventory before adding stock.</p> : null}
    </>}
    <button type="button" onClick={onClose}>Done</button>
  </div>;
}
