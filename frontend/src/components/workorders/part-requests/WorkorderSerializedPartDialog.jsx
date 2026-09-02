import { useEffect, useId, useRef, useState } from "react";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import { Button } from "../../ui/Button.jsx";
import { InventoryCodeScanner } from "../../../features/inventory/InventoryCodeScanner.jsx";
import { api } from "../../../lib/api.js";
import { normalizeLocale } from "../../../i18n/index.js";
import "./workorder-serialized-part-dialog.css";

const DIALOG_TEXT = {
  en: { title: "Serialized unit", choose: "Choose serialized unit", add: "Add serialized units", ready: "QR labels ready", location: "Workorder location", close: "Close", quantity: "Quantity", creates: "Creates one permanent serial number and QR label per unit.", confirm: "I confirm these units are physically present at", back: "Back to units", scan: "Scan a label", manual: "Enter code manually", code: "Label link or exact serial", search: "Find exact serial", searchButton: "Search", searching: "Searching…", loading: "Loading serialized units…", none: "No serialized units are available at", addUnits: "Add units", ask: "Ask an authorized inventory user to add physical units at this location.", available: "Available serialized units", availability: "serialized units available", stock: "In stock", selected: "Use selected unit", adding: "Adding part…", more: "Load more", printed: "Print", labels: "QR labels", error: "Something went wrong. Try again." },
  es: { title: "Unidad serializada", choose: "Elegir unidad serializada", add: "Agregar unidades serializadas", ready: "Etiquetas QR listas", location: "Ubicación de la orden", close: "Cerrar", quantity: "Cantidad", creates: "Crea un número de serie permanente y una etiqueta QR por unidad.", confirm: "Confirmo que estas unidades están físicamente presentes en", back: "Volver a unidades", scan: "Escanear una etiqueta", manual: "Ingresar código manualmente", code: "Enlace de etiqueta o número de serie exacto", search: "Buscar número de serie exacto", searchButton: "Buscar", searching: "Buscando…", loading: "Cargando unidades serializadas…", none: "No hay unidades serializadas disponibles en", addUnits: "Agregar unidades", ask: "Pida a un usuario autorizado que agregue unidades físicas en esta ubicación.", available: "Unidades serializadas disponibles", availability: "unidades serializadas disponibles", stock: "En stock", selected: "Usar unidad seleccionada", adding: "Agregando pieza…", more: "Cargar más", printed: "Imprimir", labels: "etiquetas QR", error: "Algo salió mal. Inténtelo de nuevo." },
  pa: { title: "ਸੀਰੀਅਲ ਯੂਨਿਟ", choose: "ਸੀਰੀਅਲ ਯੂਨਿਟ ਚੁਣੋ", add: "ਸੀਰੀਅਲ ਯੂਨਿਟ ਜੋੜੋ", ready: "QR ਲੇਬਲ ਤਿਆਰ ਹਨ", location: "ਵਰਕਆਰਡਰ ਟਿਕਾਣਾ", close: "ਬੰਦ ਕਰੋ", quantity: "ਮਾਤਰਾ", creates: "ਹਰ ਯੂਨਿਟ ਲਈ ਇੱਕ ਪੱਕਾ ਸੀਰੀਅਲ ਨੰਬਰ ਅਤੇ QR ਲੇਬਲ ਬਣਾਉਂਦਾ ਹੈ।", confirm: "ਮੈਂ ਪੁਸ਼ਟੀ ਕਰਦਾ ਹਾਂ ਕਿ ਇਹ ਯੂਨਿਟ ਇੱਥੇ ਮੌਜੂਦ ਹਨ", back: "ਯੂਨਿਟਾਂ ਤੇ ਵਾਪਸ", scan: "ਲੇਬਲ ਸਕੈਨ ਕਰੋ", manual: "ਕੋਡ ਹੱਥੀਂ ਦਰਜ ਕਰੋ", code: "ਲੇਬਲ ਲਿੰਕ ਜਾਂ ਸਹੀ ਸੀਰੀਅਲ", search: "ਸਹੀ ਸੀਰੀਅਲ ਲੱਭੋ", searchButton: "ਲੱਭੋ", searching: "ਲੱਭ ਰਿਹਾ ਹੈ…", loading: "ਸੀਰੀਅਲ ਯੂਨਿਟ ਲੋਡ ਹੋ ਰਹੇ ਹਨ…", none: "ਇਸ ਟਿਕਾਣੇ ਤੇ ਕੋਈ ਸੀਰੀਅਲ ਯੂਨਿਟ ਨਹੀਂ ਹੈ", addUnits: "ਯੂਨਿਟ ਜੋੜੋ", ask: "ਅਧਿਕਾਰਤ ਇਨਵੈਂਟਰੀ ਉਪਭੋਗਤਾ ਨੂੰ ਇਸ ਟਿਕਾਣੇ ਤੇ ਅਸਲ ਯੂਨਿਟ ਜੋੜਨ ਲਈ ਕਹੋ।", available: "ਉਪਲਬਧ ਸੀਰੀਅਲ ਯੂਨਿਟ", availability: "ਸੀਰੀਅਲ ਯੂਨਿਟ ਉਪਲਬਧ ਹਨ", stock: "ਸਟਾਕ ਵਿੱਚ", selected: "ਚੁਣੀ ਯੂਨਿਟ ਵਰਤੋ", adding: "ਪਾਰਟ ਜੋੜਿਆ ਜਾ ਰਿਹਾ ਹੈ…", more: "ਹੋਰ ਲੋਡ ਕਰੋ", printed: "ਛਾਪੋ", labels: "QR ਲੇਬਲ", error: "ਕੁਝ ਗਲਤ ਹੋ ਗਿਆ। ਮੁੜ ਕੋਸ਼ਿਸ਼ ਕਰੋ।" },
};

function key(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function errorText(error, text) {
  return error?.message || text.error;
}

function unitsFrom(result) {
  return result?.units || result?.items || [];
}

function pendingCreateStorageKey({ actorId, workorderId, partId, quantity, confirmation }) {
  return ["workorder-serialized-create", actorId || "session", workorderId, partId, quantity, confirmation].join(":");
}

function storedPendingCreateKey(storageKey) {
  try {
    return window.sessionStorage.getItem(storageKey) || "";
  } catch {
    return "";
  }
}

function storePendingCreateKey(storageKey, value) {
  try {
    window.sessionStorage.setItem(storageKey, value);
  } catch {
    // Session storage can be unavailable in privacy-restricted browsers. The
    // in-memory key still protects retries while this dialog remains open.
  }
}

function clearPendingCreateKey(storageKey) {
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // Nothing further to do when browser storage is unavailable.
  }
}

/**
 * One controller for the catalog chooser, on-demand intake, label hand-off,
 * and camera/manual assignment. It deliberately never opens another modal.
 */
export function WorkorderSerializedPartDialog({
  open,
  actorId,
  workorderId,
  catalogPart,
  onClose,
  onReserved,
  locale = "en",
}) {
  const [view, setView] = useState("units");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [physicallyPresent, setPhysicallyPresent] = useState(false);
  const [selectedUnitId, setSelectedUnitId] = useState("");
  const [serialQuery, setSerialQuery] = useState("");
  const requestKeyRef = useRef({ identity: "", key: "" });
  const createKeyRef = useRef({ identity: "", key: "" });
  const quantityRef = useRef(null);
  const addUnitsRef = useRef(null);
  const emptyStatusRef = useRef(null);
  const printRef = useRef(null);
  const contentRef = useRef(null);
  const dialogId = useId();
  const partId = catalogPart?.id || catalogPart?.catalogPartId;
  const endpoint = partId && workorderId
    ? `/api/workorders/${encodeURIComponent(workorderId)}/inventory-parts/${encodeURIComponent(partId)}/units`
    : "";
  const part = data?.part || catalogPart || {};
  const partNumber = part.partNumber || part.normalizedPartNumber || "";
  const partDescription = part.description?.trim();
  const showDescription = partDescription && partDescription.toLocaleLowerCase() !== partNumber.trim().toLocaleLowerCase();
  const locationName = data?.location?.name || data?.location?.locationName || catalogPart?.locationName || "this workorder location";
  const units = unitsFrom(data);
  const text = DIALOG_TEXT[normalizeLocale(locale)] || DIALOG_TEXT.en;
  // The server is the permission authority. Do not infer creation access from
  // stock, role, or the catalog result.
  const canCreate = data?.canCreateSerializedUnits === true;

  async function load({ query = serialQuery, cursor = "", append = false } = {}) {
    if (!endpoint) return;
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (cursor) params.set("cursor", cursor);
      params.set("limit", "25");
      const result = await api(`${endpoint}${params.size ? `?${params}` : ""}`);
      setData((current) => append
        ? { ...result, units: [...unitsFrom(current), ...unitsFrom(result)] }
        : result);
    } catch (error) {
      setMessage(errorText(error, text));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open || !endpoint) return;
    setView("units");
    setData(null);
    setMessage("");
    setQuantity("1");
    setPhysicallyPresent(false);
    setSelectedUnitId("");
    setSerialQuery("");
    requestKeyRef.current = { identity: "", key: "" };
    createKeyRef.current = { identity: "", key: "" };
    load({ query: "" });
  }, [open, endpoint]);

  useEffect(() => {
    if (view === "create") window.requestAnimationFrame(() => quantityRef.current?.focus());
    if (view === "created") window.requestAnimationFrame(() => printRef.current?.focus());
  }, [view]);

  useEffect(() => {
    if (!open || view !== "units" || loading || !data) return;
    const target = units.length
      ? contentRef.current?.querySelector(".inventory-code-manual-action")
      : canCreate ? addUnitsRef.current : emptyStatusRef.current;
    window.requestAnimationFrame(() => target?.focus());
  }, [open, view, loading, data, units.length, canCreate]);

  function close() {
    if (!busy) onClose?.();
  }

  async function createUnits(event) {
    event.preventDefault();
    const amount = Number(quantity);
    if (!Number.isInteger(amount) || amount < 1 || amount > 25) {
      setMessage("Enter a whole quantity from 1 to 25.");
      return;
    }
    if (!physicallyPresent) {
      setMessage(`${text.confirm} ${locationName}.`);
      return;
    }
    const confirmation = "physically_present_at_location";
    const identity = `${partId}:${amount}:${confirmation}`;
    const storageKey = pendingCreateStorageKey({ actorId, workorderId, partId, quantity: amount, confirmation });
    if (createKeyRef.current.identity !== identity) {
      createKeyRef.current = {
        identity,
        key: storedPendingCreateKey(storageKey) || key("workorder-serialized-create"),
      };
      storePendingCreateKey(storageKey, createKeyRef.current.key);
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await api(endpoint, {
        method: "POST",
        body: JSON.stringify({
          quantity: amount,
          confirmation,
          idempotencyKey: createKeyRef.current.key,
        }),
      });
      setData(result);
      setSelectedUnitId("");
      clearPendingCreateKey(storageKey);
      createKeyRef.current = { identity: "", key: "" };
      setView("created");
    } catch (error) {
      setMessage(errorText(error, text));
    } finally {
      setBusy(false);
    }
  }

  async function reserve({ unitId, code } = {}) {
    if (busy || (!unitId && !code)) return;
    const identity = unitId ? `unit:${unitId}` : `code:${code}`;
    if (requestKeyRef.current.identity !== identity) {
      requestKeyRef.current = { identity, key: key("workorder-serialized-issue") };
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await api(`/api/workorders/${encodeURIComponent(workorderId)}/inventory-units/issue`, {
        method: "POST",
        body: JSON.stringify({ unitId, code, idempotencyKey: requestKeyRef.current.key }),
      });
      await onReserved?.(result.usage, result);
      onClose?.();
    } catch (error) {
      // Retain the key for a retry of this exact unit/code. A different unit gets
      // a new key so it cannot collide with the prior reservation request.
      setMessage(errorText(error, text));
    } finally {
      setBusy(false);
    }
  }

  function search(event) {
    event.preventDefault();
    setSelectedUnitId("");
    load({ query: serialQuery });
  }

  const batch = data?.batch || data?.labelBatch;
  const canReserve = selectedUnitId && units.some((unit) => unit.id === selectedUnitId && unit.eligible !== false && unit.eligibility?.canIssue !== false && unit.canIssue !== false);

  return (
    <ModalOverlay className="workorder-serialized-dialog-overlay" isOpen={open} isDismissable={false}>
      <Modal className="workorder-serialized-dialog-modal">
        <Dialog className="workorder-serialized-dialog" aria-labelledby={`${dialogId}-title`} onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.preventDefault(); close(); } }}>
          <header>
            <div className="workorder-serialized-heading">
              <h2 id={`${dialogId}-title`}>{view === "create" ? text.add : view === "created" ? text.ready : text.choose}</h2>
              <div className="workorder-serialized-context" aria-label={text.title}>
                <div className="workorder-serialized-part-identity">
                  <strong>{partNumber}</strong>
                  {showDescription ? <span>{partDescription}</span> : null}
                </div>
                <div className="workorder-serialized-meta">
                  {part.uomCode ? <span>{part.uomCode}</span> : null}
                  <span>{text.location}: {locationName}</span>
                </div>
              </div>
            </div>
            <button type="button" className="workorder-serialized-close" onClick={close} disabled={busy} aria-label={text.close}>×</button>
          </header>
          <div className="workorder-serialized-dialog-content" ref={contentRef}>
            {message ? <p className="workorder-serialized-message" role="alert">{message}</p> : null}
            {view === "create" ? <form onSubmit={createUnits} className="workorder-serialized-create">
              <div className="workorder-serialized-field">
                <label>{text.quantity}<input ref={quantityRef} type="number" min="1" max="25" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} disabled={busy} /></label>
                <p>{text.creates}</p>
                {Number(quantity) > 10 ? <p className="workorder-serialized-notice">This will permanently create {quantity} serial numbers and {quantity} labels.</p> : null}
              </div>
              <label className="workorder-serialized-check"><input type="checkbox" checked={physicallyPresent} onChange={(event) => setPhysicallyPresent(event.target.checked)} disabled={busy} /><span>{text.confirm} <strong>{locationName}</strong>.</span></label>
              <footer><Button type="button" onClick={() => { setView("units"); window.requestAnimationFrame(() => addUnitsRef.current?.focus()); }} disabled={busy}>{text.back}</Button><Button type="submit" variant="primary" disabled={busy || !physicallyPresent}>{busy ? "Creating serialized units…" : `Create ${quantity || 1} serialized unit${Number(quantity) === 1 ? "" : "s"}`}</Button></footer>
            </form> : <>
              {view === "created" && batch?.printUrl ? <div className="workorder-serialized-ready"><strong>{text.ready}</strong><a ref={printRef} className="button primary" href={batch.printUrl} target="_blank" rel="noreferrer">{text.printed} {batch.itemCount || units.length} {text.labels}</a></div> : null}
              <section className="workorder-serialized-find" aria-labelledby={`${dialogId}-find-heading`}>
                <div className="workorder-serialized-section-heading">
                  <h3 id={`${dialogId}-find-heading`}>{text.scan}</h3>
                  <span>{text.manual}</span>
                </div>
                <div className="workorder-serialized-scan">
                  <InventoryCodeScanner autoStart resetKey={`${workorderId}:${partId}:${open}`} disabled={busy} onScan={(code) => reserve({ code })} labels={{ enterCode: text.manual, codeLabel: text.code, openError: text.error }} />
                </div>
                <form className="workorder-serialized-search" onSubmit={search}><label>{text.search}<input value={serialQuery} onChange={(event) => setSerialQuery(event.target.value)} placeholder="Full or beginning of serial" disabled={busy} /></label><Button type="submit" disabled={loading || busy}>{loading ? text.searching : text.searchButton}</Button></form>
              </section>
              {loading ? <p role="status">{text.loading}</p> : null}
              {!loading && !units.length ? <div className="workorder-serialized-empty" ref={canCreate ? undefined : emptyStatusRef} tabIndex={canCreate ? undefined : -1}>
                <span className="workorder-serialized-empty-count" aria-hidden="true">0</span>
                <div><strong>{text.none} {locationName}.</strong>{!canCreate ? <p>{text.ask}</p> : null}</div>
                {canCreate ? <Button ref={addUnitsRef} type="button" variant="primary" onClick={() => setView("create")} disabled={busy}>{text.addUnits}</Button> : null}
              </div> : null}
              {units.length ? <fieldset className="workorder-serialized-unit-list"><legend><span>{text.available}</span><small role="status">{units.length} {text.availability}</small></legend>{units.map((unit) => <label key={unit.id} className="workorder-serialized-unit"><input type="radio" name="serialized-unit" value={unit.id} checked={selectedUnitId === unit.id} onChange={() => setSelectedUnitId(unit.id)} disabled={busy || unit.eligible === false || unit.eligibility?.canIssue === false || unit.canIssue === false} /><span><strong>{unit.partNumber || part.partNumber}</strong><code>{unit.serialNumber || unit.serial}</code><small>{unit.status === "in_stock" ? text.stock : unit.status}{unit.locationName ? ` · ${unit.locationName}` : ""}</small></span></label>)}</fieldset> : null}
              {data?.nextCursor ? <Button type="button" onClick={() => load({ cursor: data.nextCursor, append: true })} disabled={loading || busy}>{text.more}</Button> : null}
              {units.length ? <footer>{canCreate ? <Button type="button" onClick={() => setView("create")} disabled={busy}>{text.addUnits}</Button> : <span /> }<Button type="button" variant="primary" onClick={() => reserve({ unitId: selectedUnitId })} disabled={!canReserve || busy}>{busy ? text.adding : text.selected}</Button></footer> : null}
            </>}
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
