import { useEffect, useRef, useState } from "react";
import { Camera01, CheckCircle, Scan } from "@untitledui/icons";
import { Button } from "../../components/ui/Button.jsx";
import { api } from "../../lib/api.js";
import "./inventory-scan.css";

function initialCode() {
  return new URLSearchParams(window.location.search).get("inventoryScan") || "";
}

function eventLabel(type) {
  return {
    receipt_staged: "Identity prepared",
    receipt_confirmed: "Received in Odoo",
    receipt_recorded: "Added to local inventory",
    reconciliation_required: "Needs reconciliation",
    void: "Voided",
  }[type] || type.replaceAll("_", " ");
}

export function InventoryScanWorkspace({ actor }) {
  const [code, setCode] = useState(initialCode);
  const [unit, setUnit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const resolveInFlightRef = useRef(false);

  function stopCamera() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraActive(false);
  }

  async function resolve(codeValue) {
    const next = String(codeValue || "").trim();
    if (!next || resolveInFlightRef.current) return;
    resolveInFlightRef.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await api("/api/inventory/resolve", {
        method: "POST",
        body: JSON.stringify({ code: next }),
      });
      setUnit(result.unit);
      setCode(next);
      stopCamera();
    } catch (error) {
      setUnit(null);
      setMessage(error.message);
    } finally {
      resolveInFlightRef.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    const saved = initialCode();
    if (saved) resolve(saved);
    return stopCamera;
  }, []);

  async function startCamera() {
    setMessage("");
    if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) {
      setMessage("Camera scanning is not available here. Paste the label link or enter its code below.");
      return;
    }
    try {
      const detector = new window.BarcodeDetector({ formats: ["qr_code", "code_128"] });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      setCameraActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      timerRef.current = window.setInterval(async () => {
        if (!videoRef.current || resolveInFlightRef.current) return;
        try {
          const [result] = await detector.detect(videoRef.current);
          if (result?.rawValue) await resolve(result.rawValue);
        } catch {
          // A frame can fail while the camera focuses; the next frame remains safe to try.
        }
      }, 300);
    } catch {
      stopCamera();
      setMessage("Camera access was unavailable. Paste the label link or enter its code below.");
    }
  }

  return (
    <main className="inventory-scan-workspace">
      <section className="inventory-scan-card" aria-labelledby="inventory-scan-title">
        <header>
          <span className="inventory-scan-icon"><Scan aria-hidden="true" /></span>
          <div><h1 id="inventory-scan-title">Scan part</h1><p>{actor?.name ? `${actor.name} · ` : ""}One label opens one exact inventory unit.</p></div>
        </header>
        {unit ? (
          <section className="inventory-scan-result" aria-live="polite">
            <div className="inventory-scan-status"><CheckCircle aria-hidden="true" /><span><strong>{unit.status === "in_stock" ? "In stock" : unit.status.replaceAll("_", " ")}</strong><small>{unit.locationName}</small></span></div>
            <dl>
              <div><dt>Part</dt><dd><strong>{unit.partNumber}</strong><span>{unit.description}</span></dd></div>
              <div><dt>Serial</dt><dd><code>{unit.serialNumber}</code></dd></div>
              <div><dt>Receipt</dt><dd>{unit.receipt.provider === "local" ? "Local invoice receipt" : unit.receipt.reference || "Odoo receipt"}</dd></div>
            </dl>
            <ol className="inventory-scan-history">
              {unit.events.map((event) => <li key={`${event.type}-${event.at}`}><span>{eventLabel(event.type)}</span><time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time></li>)}
            </ol>
            <Button type="button" onClick={() => { setUnit(null); setCode(""); }}>Scan another</Button>
          </section>
        ) : (
          <>
            <video ref={videoRef} className={`inventory-camera${cameraActive ? " is-active" : ""}`} muted playsInline aria-label="QR scanner camera" />
            <Button type="button" variant="primary" icon={Camera01} onClick={cameraActive ? stopCamera : startCamera} disabled={busy}>
              {cameraActive ? "Stop camera" : "Use camera"}
            </Button>
            <form onSubmit={(event) => { event.preventDefault(); resolve(code); }}>
              <label htmlFor="inventory-code"><span>Label link or code</span><input id="inventory-code" value={code} onChange={(event) => setCode(event.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck="false" placeholder="Paste or scan code" /></label>
              <Button type="submit" icon={Scan} disabled={busy || !code.trim()}>{busy ? "Checking…" : "Open part"}</Button>
            </form>
          </>
        )}
        {message ? <p className="inventory-scan-message" role="alert">{message}</p> : null}
        <Button className="inventory-scan-back" type="button" onClick={() => window.location.assign("/")}>Back to workspace</Button>
      </section>
    </main>
  );
}
