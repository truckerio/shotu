import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../../../lib/api.js";
import { StockIntakeControl } from "../../../components/inventory/StockIntakeControl.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { serializedPickerPlacement } from "../../../components/workorders/part-requests/serialized-picker-placement.js";

export function CreateStockDropdown({ locationId, part, onChange, onClose }) {
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
    Promise.all([
      api(`/api/office/inventory/parts/${encodeURIComponent(part.catalogPartId)}/locations/${encodeURIComponent(locationId)}/units`),
      api(`/api/office/inventory/parts/${encodeURIComponent(part.catalogPartId)}/locations/${encodeURIComponent(locationId)}/positions`),
    ])
      .then(([stock, positionStock]) => { if (active) setData({ ...stock, positionStock }); })
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
  const requestedQuantity = Number(part.qty || 0);
  const positions = (data?.positionStock?.positions || []).filter((position) => (
    position.isActive && position.canStore && position.isPickable && Number(position.available) > 0
  ));
  const selectedPosition = positions.find((position) => position.id === part.sourcePositionId);
  const requiresSourcePosition = ["quantity", "measured_bulk"].includes(data?.part?.trackingMode || part.trackingMode);
  return <div ref={rootRef} className="create-stock-dropdown" role="dialog" aria-label={`Stock for ${part.partNo}`} style={{ top: placement.side === "above" ? "auto" : "calc(100% + 6px)", bottom: placement.side === "above" ? "calc(100% + 6px)" : "auto", maxHeight: placement.maxHeight }} onKeyDown={(event) => {
    if (event.key === "Escape" && !event.target.closest?.(".stock-intake-overlay")) { event.preventDefault(); event.stopPropagation(); onClose?.(); }
  }}>
    {error ? <p role="alert">{error}</p> : !data ? <p role="status">Loading stock…</p> : <>
      <strong>{data.location.locationName}</strong>
      <p>{Math.max(0, data.location.localQuantityOnHand - data.location.localQuantityReserved)} {uom} available</p>
      <fieldset className="create-stock-positions">
        <legend>Pick from</legend>
        {positions.map((position) => {
          const available = Number(position.available);
          const disabled = requestedQuantity > 0 && available < requestedQuantity;
          return <label className={disabled ? "is-disabled" : ""} key={position.id}>
            <input
              checked={part.sourcePositionId === position.id}
              disabled={disabled}
              name={`source-position-${part.catalogPartId}`}
              onChange={() => onChange?.({
                sourcePositionId: position.id,
                sourcePositionPath: position.path,
                trackingMode: data.part.trackingMode,
              })}
              type="radio"
            />
            <span><strong>{position.path}</strong><small>{available} {uom}</small></span>
          </label>;
        })}
        {!positions.length ? <p>No pickable stock location.</p> : null}
      </fieldset>
      <StockIntakeControl catalogPartId={part.catalogPartId} locationId={locationId} initialData={data} onReceived={() => setRevision((value) => value + 1)} />
      {!data.part.trackingMode ? <p>Review tracking in Inventory before adding stock.</p> : null}
    </>}
    <Button type="button" disabled={requiresSourcePosition && !selectedPosition} onClick={onClose}>Done</Button>
  </div>;
}
