import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw01 } from "@untitledui/icons";
import { Button } from "../../components/ui/Button.jsx";
import { IconButton } from "../../components/ui/IconButton.jsx";
import { Checkbox } from "../../components/ui/Checkbox.jsx";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { api } from "../../lib/api.js";
import {
  clearPositionRequestKey,
  destinationPositions,
  eligibleSerializedPositionUnits,
  moveDestinations,
  occupiedPositions,
  isStalePositionError,
  positionDraftKey,
  positionMoveBody,
  positionRequestKey,
} from "./inventory-location-model.js";
import "./inventory-locations-workspace.css";

function partId(part) {
  return part?.catalogPartId || part?.partId || part?.id || "";
}
function number(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(
    Number(value || 0),
  );
}
function responsePositions(response) {
  return response?.positions || response?.items || [];
}
function positionName(position) {
  return (
    position?.path ||
    position?.positionPath ||
    position?.code ||
    position?.name ||
    "Unassigned"
  );
}
function positionLabel(position) {
  const code = String(position?.code || "").trim();
  const name = String(position?.name || "").trim();
  if (code) return name && name.toLocaleLowerCase() !== code.toLocaleLowerCase() ? `${code} · ${name}` : code;
  return positionName(position);
}
function naturalPositionCompare(left, right) {
  return positionLabel(left).localeCompare(positionLabel(right), undefined, { numeric: true, sensitivity: "base" });
}

export function PartPositionsPanel({ item, part, location, initialSourcePositionId = "", onChanged }) {
  const subject = part || item;
  const catalogPartId = partId(subject);
  const locationId = location?.locationId || location?.id || "";
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(catalogPartId && locationId));
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [showEmptyPositions, setShowEmptyPositions] = useState(false);
  const [draft, setDraft] = useState({
    sourcePositionId: initialSourcePositionId,
    destinationPositionId: "",
    quantity: "",
    serialUnitIds: [],
  });
  const [busy, setBusy] = useState(false);
  const keys = useRef(new Map());
  const endpoint = `/api/office/inventory/parts/${encodeURIComponent(catalogPartId)}/locations/${encodeURIComponent(locationId)}/positions`;
  const load = useCallback(async () => {
    if (!catalogPartId || !locationId) return;
    setLoading(true);
    setError("");
    setData(null);
    try {
      setData(await api(endpoint));
      setStale(false);
    } catch (next) {
      setError(next.message || "Position amounts could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [catalogPartId, endpoint, locationId]);
  useEffect(() => {
    setDraft({
      sourcePositionId: initialSourcePositionId,
      destinationPositionId: "",
      quantity: "",
      serialUnitIds: [],
    });
    setShowEmptyPositions(false);
    load();
  }, [initialSourcePositionId, load]);
  const positions = useMemo(() => responsePositions(data), [data]);
  const units = data?.units || data?.serialUnits || [];
  const trackingMode =
    data?.trackingMode || subject?.trackingMode || "quantity";
  const stockPositions = destinationPositions(positions).filter(
    (entry) => entry.isPickable === true && entry.supportsMove !== false,
  ).sort(naturalPositionCompare);
  const occupiedStockPositions = occupiedPositions(stockPositions);
  const visibleStockPositions = showEmptyPositions ? stockPositions : occupiedStockPositions;
  const emptyPositionCount = stockPositions.length - occupiedStockPositions.length;
  const selectedSource = positions.find(
    (entry) => (entry.id || entry.positionId) === draft.sourcePositionId,
  );
  const eligibleUnits = eligibleSerializedPositionUnits(
    units,
    draft.sourcePositionId,
  );
  const sourceOptions = [...occupiedStockPositions]
    .sort(
      (left, right) => Number(right.quantity || 0) - Number(left.quantity || 0),
    )
    .map((entry) => ({
      id: entry.positionId || entry.id,
      label: `${positionLabel(entry)} (${number(entry.quantity)} ${data?.uomCode || subject?.uomCode || ""})`,
    }));
  async function move(event) {
    event.preventDefault();
    const quantity = Number(draft.quantity);
    if (
      !draft.sourcePositionId ||
      !draft.destinationPositionId ||
      (!draft.serialUnitIds.length &&
        (!Number.isFinite(quantity) || quantity <= 0))
    ) {
      setError(
        trackingMode === "serialized"
          ? "Select a source, at least one serial unit, and a destination."
          : "Choose source and destination positions, then enter a positive quantity.",
      );
      return;
    }
    const identity = positionDraftKey({
      partId: catalogPartId,
      locationId,
      ...draft,
    });
    const key = keys.current.get(identity) || positionRequestKey(identity);
    keys.current.set(identity, key);
    setBusy(true);
    setError("");
    try {
      const source = positions.find(
        (entry) => (entry.id || entry.positionId) === draft.sourcePositionId,
      );
      const destination = positions.find(
        (entry) =>
          (entry.id || entry.positionId) === draft.destinationPositionId,
      );
      await api(`${endpoint}/moves`, {
        method: "POST",
        body: JSON.stringify(
          positionMoveBody({
            source,
            destination,
            quantity,
            unitIds: draft.serialUnitIds,
            unitVersions: Object.fromEntries(
              eligibleUnits
                .filter((unit) =>
                  draft.serialUnitIds.includes(unit.id || unit.unitId),
                )
                .map((unit) => [unit.id || unit.unitId, unit.custodyVersion]),
            ),
            idempotencyKey: key,
          }),
        ),
      });
      clearPositionRequestKey(identity);
      keys.current.delete(identity);
      setDraft({
        sourcePositionId: "",
        destinationPositionId: "",
        quantity: "",
        serialUnitIds: [],
      });
      await load();
      onChanged?.();
    } catch (next) {
      if (isStalePositionError(next)) {
        setStale(true);
        setError(
          "Stock positions changed elsewhere. Reload before making another move.",
        );
      } else
        setError(
          next.message ||
            "The placement move could not be saved. Retry keeps the same request.",
        );
    } finally {
      setBusy(false);
    }
  }
  if (!catalogPartId || !locationId) return null;
  const destinations = moveDestinations(stockPositions, draft.sourcePositionId);
  return (
    <section
      className="part-positions-panel"
      aria-labelledby="part-positions-title"
    >
      <header>
        <h3 id="part-positions-title">Shelf positions</h3>
        <div className="part-positions-header-actions">
          {emptyPositionCount ? (
            <Button
              type="button"
              className="part-position-visibility-toggle"
              aria-pressed={showEmptyPositions}
              onClick={() => setShowEmptyPositions((value) => !value)}
            >
              {showEmptyPositions ? "Hide empty" : `Show empty (${emptyPositionCount})`}
            </Button>
          ) : null}
          <IconButton
            icon={RefreshCw01}
            label="Refresh shelf positions"
            onClick={load}
            disabled={loading || busy}
          />
        </div>
      </header>
      {data?.reconciliationRequired ? (
        <p role="alert" className="ops-error">
          Locations need review before stock can be moved. Shop totals remain
          available above.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="ops-error">
          {error}
        </p>
      ) : null}
      {stale ? (
        <Button type="button" onClick={load} disabled={loading}>
          Reload current positions
        </Button>
      ) : null}
      {loading ? (
        <p role="status">Loading positions…</p>
      ) : data && !data.reconciliationRequired ? (
        <>
          {visibleStockPositions.length ? (
            <div className="part-position-list">
              {visibleStockPositions.map((entry) => (
                <article key={entry.positionId || entry.id}>
                  <div>
                    <strong>{positionLabel(entry)}</strong>
                  </div>
                  <span>
                    {number(entry.quantity)} {data?.uomCode || subject?.uomCode}
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <p className="part-position-empty">
              No shelves or bins currently hold this part.
            </p>
          )}
          <form className="part-position-move" onSubmit={move}>
            <h4>Put away or move stock</h4>
            <label>
              From
              <Dropdown
                value={draft.sourcePositionId}
                aria-label="Source position"
                disabled={busy || stale || data?.reconciliationRequired}
                onChange={(event) =>
                  setDraft((value) => ({
                    ...value,
                    sourcePositionId: event.target.value,
                    destinationPositionId:
                      value.destinationPositionId === event.target.value
                        ? ""
                        : value.destinationPositionId,
                    serialUnitIds: [],
                  }))
                }
              >
                <option value="">Choose a source</option>
                {sourceOptions.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </Dropdown>
            </label>
            <label>
              To
              <Dropdown
                value={draft.destinationPositionId}
                aria-label="Destination position"
                disabled={busy || stale || data?.reconciliationRequired}
                onChange={(event) =>
                  setDraft((value) => ({
                    ...value,
                    destinationPositionId: event.target.value,
                  }))
                }
              >
                <option value="">Choose a stock position</option>
                {destinations.map((entry) => (
                  <option
                    key={entry.positionId || entry.id}
                    value={entry.positionId || entry.id}
                  >
                    {positionLabel(entry)}
                  </option>
                ))}
              </Dropdown>
            </label>
            {trackingMode === "serialized" ? (
              <fieldset
                disabled={busy || stale || data?.reconciliationRequired}
              >
                <legend>Serial units</legend>
                {selectedSource ? (
                  <p>Source: {positionLabel(selectedSource)}</p>
                ) : null}
                {eligibleUnits.length ? (
                  eligibleUnits.map((unit) => (
                    <label
                      key={unit.id || unit.unitId}
                      className="inventory-location-checkbox"
                    >
                      <Checkbox
                        checked={draft.serialUnitIds.includes(
                          unit.id || unit.unitId,
                        )}
                        onChange={(event) => {
                          const id = unit.id || unit.unitId;
                          setDraft((value) => ({
                            ...value,
                            serialUnitIds: event.target.checked
                              ? [...value.serialUnitIds, id]
                              : value.serialUnitIds.filter(
                                  (entry) => entry !== id,
                                ),
                          }));
                        }}
                      />{" "}
                      {unit.serialNumber || unit.code || unit.id}
                    </label>
                  ))
                ) : (
                  <p>
                    {selectedSource
                      ? "No eligible serial units are available at this source."
                      : "Choose a source position to see eligible serial units."}
                  </p>
                )}
              </fieldset>
            ) : (
              <label>
                Quantity
                <input
                  type="number"
                  min="0.001"
                  step="any"
                  value={draft.quantity}
                  disabled={busy || stale || data?.reconciliationRequired}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      quantity: event.target.value,
                    }))
                  }
                />
              </label>
            )}
            <footer>
              <Button
                type="submit"
                variant="primary"
                disabled={busy || stale || data?.reconciliationRequired}
              >
                {busy ? "Saving placement…" : "Save placement"}
              </Button>
            </footer>
          </form>
        </>
      ) : null}
    </section>
  );
}
