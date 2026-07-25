import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle, FileSearch01, MessageChatCircle, Package, Pin01, RefreshCw01, Save01, XClose } from "@untitledui/icons";
import { PreviewPane, PreviewToggle } from "../components/preview/PreviewPane.jsx";
import { Button } from "../components/ui/Button.jsx";
import { ChatComposer } from "../components/workorders/ChatComposer.jsx";
import { ChatThread } from "../components/workorders/ChatThread.jsx";
import { PartRequestsPanel } from "../components/workorders/PartRequestsPanel.jsx";
import { WorkorderDetailLayout } from "../components/workorders/WorkorderDetailLayout.jsx";
import { WorkorderTimelinePanel } from "../components/workorders/WorkorderTimeline.jsx";
import { WorkorderStatusPill } from "../components/workorders/WorkorderStatusPill.jsx";
import { MechanicWorkspace } from "../features/mechanic/MechanicWorkspace.jsx";
import { OfficeWorkspace } from "../features/office/OfficeWorkspace.jsx";
import { SurveillanceWorkspace } from "../features/surveillance/SurveillanceWorkspace.jsx";
import { Field, PreviewFullscreen, PrintModal, SamsaraActionButton, WorkorderPreview, satelliteTiles } from "../features/generator/GeneratorUi.jsx";
import { api } from "../lib/api.js";
import { emptyPart, workDateRangeLabel, workorderTemplateStyles } from "../../../shared/workorder-template.js";
import "../styles.css";

const AdminWorkspace = lazy(() => import("../features/admin/AdminWorkspace.jsx").then((module) => ({ default: module.AdminWorkspace })));

const todayIso = () => {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

function formatSerial(prefix, number, digits) {
  return `${prefix || ""}${String(Number(number) || 1).padStart(Number(digits) || 1, "0")}`;
}

function splitSerial(serial = "") {
  const match = /^(.*?)(\d+)$/.exec(serial.trim());
  if (!match) return { prefix: "WO-", nextNumber: 1, digits: 6 };
  return { prefix: match[1], nextNumber: Number(match[2]), digits: match[2].length };
}

function AssetLocationCard({
  vehicle,
  location,
  mapsConfig,
  loading,
  onRefresh,
  showRefresh = true,
  showVehicleLabel = true,
}) {
  const cardRef = useRef(null);
  const mapPanelId = useId();
  const [mapOpen, setMapOpen] = useState(false);
  const [mapPinned, setMapPinned] = useState(false);
  const unitLabel = vehicle?.unitNo || vehicle?.unit_no || vehicle?.name || "Vehicle";
  const mapVisible = Boolean(location) && (mapOpen || mapPinned);

  useEffect(() => {
    if (!mapOpen || mapPinned) return undefined;

    const closeMapOutside = (event) => {
      if (!cardRef.current?.contains(event.target)) setMapOpen(false);
    };

    document.addEventListener("pointerdown", closeMapOutside);
    return () => document.removeEventListener("pointerdown", closeMapOutside);
  }, [mapOpen, mapPinned]);

  if (!vehicle?.id) return null;

  return (
    <div
      ref={cardRef}
      className={`asset-location-card ${mapVisible ? "is-map-visible" : ""} ${mapPinned ? "is-map-pinned" : ""}`}
    >
      <div className="asset-location-header">
        <button
          className="asset-location-copy asset-location-toggle"
          type="button"
          aria-controls={location ? mapPanelId : undefined}
          aria-expanded={mapVisible}
          disabled={!location}
          onClick={() => {
            if (!mapPinned) setMapOpen((open) => !open);
          }}
        >
          {showVehicleLabel ? <strong>{unitLabel}</strong> : null}
          <span className="asset-location-address">
            {location ? (location.address || `${location.latitude}, ${location.longitude}`) : "Location not available yet"}
          </span>
        </button>
        <div className="asset-location-actions">
          {showRefresh ? (
            <button
              className={`location-refresh-button icon-tooltip ${loading ? "is-refreshing" : ""}`}
              type="button"
              onClick={onRefresh}
              disabled={loading}
              aria-label={loading ? "Refreshing live location" : "Refresh live location"}
              data-tooltip={loading ? "Refreshing location" : "Refresh location"}
            >
              <RefreshCw01 />
            </button>
          ) : null}
          {location ? (
            <button
              className="map-hover-trigger map-pin-button icon-tooltip"
              type="button"
              aria-label={mapPinned ? "Unpin satellite map" : "Pin satellite map open"}
              aria-controls={mapPanelId}
              aria-expanded={mapVisible}
              aria-pressed={mapPinned}
              data-tooltip={mapPinned ? "Unpin map" : "Pin map open"}
              onClick={() => {
                setMapOpen(true);
                setMapPinned((pinned) => !pinned);
              }}
            >
              <Pin01 />
            </button>
          ) : null}
        </div>
      </div>
      {location ? (
        <div
          className="asset-map-hover"
          id={mapPanelId}
          role="group"
          aria-label="Satellite asset location"
          aria-hidden={!mapVisible}
        >
          <div className="asset-map-tiles" aria-hidden="true">
            {satelliteTiles(location, mapsConfig).map((tile) => (
              <img key={tile.key} src={tile.src} alt="" loading="lazy" />
            ))}
            <span className="asset-map-pin" />
          </div>
          <div className="asset-map-meta">
            <span>{location.time ? new Date(location.time).toLocaleString() : "Live GPS"}</span>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`}
              target="_blank"
              rel="noreferrer"
            >
              Open map
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function App({ actor }) {
  const formRef = useRef(null);
  const previewRef = useRef(null);
  const previewGridRef = useRef(null);
  const mechanicLocationRefreshRef = useRef("");
  const [workspace, setWorkspace] = useState(() => {
    if (typeof window === "undefined") return "mechanic";
    const params = new URLSearchParams(window.location.search);
    if ((actor.role === "office" || actor.role === "admin") && (params.has("workorder") || params.get("view") === "create")) return "generator";
    if (actor.role === "mechanic" && params.has("workorder")) return "generator";
    if (actor.role === "surveillance") return "surveillance";
    if (actor.role === "admin") return "admin";
    return actor.role === "mechanic" ? "mechanic" : "office";
  });
  const [mode, setMode] = useState(() => (actor.role === "mechanic" ? "mechanic" : "admin"));
  const [routeLoading, setRouteLoading] = useState(() => (typeof window === "undefined" ? false : new URLSearchParams(window.location.search).has("workorder")));
  const [activeWorkorder, setActiveWorkorder] = useState(null);
  const [mechanicAction, setMechanicAction] = useState({ busy: "", message: "" });
  const [mechanicFinish, setMechanicFinish] = useState({ open: false, name: "", message: "" });
  const [mechanicTruckDetailsOpen, setMechanicTruckDetailsOpen] = useState(false);
  const [officeCloseOpen, setOfficeCloseOpen] = useState(false);
  const [officeCloseNote, setOfficeCloseNote] = useState("");
  const [officeAssignment, setOfficeAssignment] = useState({ mechanicUserIds: [], reason: "" });
  const [previewPanelOpen, setPreviewPanelOpen] = useState(false);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const [fullscreenPageIndex, setFullscreenPageIndex] = useState(0);
  const [fullscreenZoom, setFullscreenZoom] = useState(1);
  const [isPhone, setIsPhone] = useState(() => (typeof window === "undefined" ? false : window.matchMedia("(max-width: 700px)").matches));
  const [isCompact, setIsCompact] = useState(() => (typeof window === "undefined" ? false : window.matchMedia("(max-width: 1180px)").matches));
  const [openSection, setOpenSection] = useState("vehicle");
  const [printers, setPrinters] = useState([]);
  const [printMenuOpen, setPrintMenuOpen] = useState(false);
  const [printState, setPrintState] = useState({ open: false, stage: "idle", message: "" });
  const [officeCreateState, setOfficeCreateState] = useState({ busy: false, message: "" });
  const [officeDetailState, setOfficeDetailState] = useState({ busy: false, message: "" });
  const [vehicleLookup, setVehicleLookup] = useState({ loading: false, syncing: false, status: "", results: [] });
  const [samsaraIntegration, setSamsaraIntegration] = useState({ loading: true, connected: false, authType: "none" });
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [officeLocations, setOfficeLocations] = useState([]);
  const [mapsConfig, setMapsConfig] = useState({});
  const [detailStatus, setDetailStatus] = useState("open");
  const [detailSource, setDetailSource] = useState(null);
  const [form, setForm] = useState({
    companyName: "Chino Yard",
    locationId: actor.locationIds?.[0] || "",
    headerTitle: "CHINO YARD WORKORDER",
    brandTop: "PRO TEC",
    brandBottom: "REPAIR",
    warrantyText: "NO WARRANTY ON PARTS SUPPLIED BY CUSTOMER",
    responsibilityText: "Not responsible for loss or damage to vehicle in case of fire, theft or any other cause beyond our control.",
    authorizationText: "I authorize the above repair to be completed along with necessary material(s). I grant you and/or your employees permission to operate the vehicle described herein on street, highways, or elsewhere for the purpose of testing and/or inspection. An express mechanic's lien is hereby acknowledged on above vehicle to secure the amount of repairs thereto.",
    prefix: "WO-",
    nextNumber: 1,
    digits: 6,
    copies: 1,
    printerName: "",
    workDate: todayIso(),
    workStartDate: todayIso(),
    workEndDate: todayIso(),
    unitNo: "",
    unitType: "",
    licenseNo: "",
    mileage: "",
    model: "",
    vinNo: "",
    mechanicConcern: "",
    mechanicName: "",
    startTime: "",
    endTime: "",
    managerName: "",
    officeNotes: "",
    customerSignature: "",
    authorizedBy: "",
    parts: [emptyPart(), emptyPart(), emptyPart()],
  });

  const effectiveCopies = activeWorkorder ? 1 : Math.max(1, Number(form.copies) || 1);
  const firstSerial = useMemo(() => formatSerial(form.prefix, form.nextNumber, form.digits), [form.prefix, form.nextNumber, form.digits]);
  const lastSerial = useMemo(() => {
    const last = (Number(form.nextNumber) || 1) + effectiveCopies - 1;
    return formatSerial(form.prefix, last, form.digits);
  }, [form.prefix, form.nextNumber, form.digits, effectiveCopies]);
  const range = firstSerial === lastSerial ? firstSerial : `${firstSerial} to ${lastSerial}`;
  const previewSerials = useMemo(
    () => Array.from({ length: effectiveCopies }, (_, index) => formatSerial(form.prefix, (Number(form.nextNumber) || 1) + index, form.digits)),
    [form.prefix, form.nextNumber, form.digits, effectiveCopies],
  );
  const workorderCountLabel = activeWorkorder ? "1 workorder" : `${effectiveCopies} page(s)`;
  const primaryActionLabel = form.printerName ? (activeWorkorder ? "Print filled workorder" : "Print workorders") : "Save PDF";
  const selectedDestinationLabel = form.printerName || "Save PDF only";
  const statusOptions = [
    { value: "open", label: "Open" },
    { value: "accepted", label: "Accepted" },
    { value: "in_progress", label: "Working" },
    { value: "waiting_office", label: "Need office" },
    { value: "parts_requested", label: "Parts requested" },
    { value: "mechanic_done", label: "Done" },
    { value: "closed", label: "Closed" },
    { value: "odoo_entered", label: "Odoo entered" },
  ];
  const currentStatusLabel = statusOptions.find((option) => option.value === detailStatus)?.label || "Open";
  const isMechanicDetail = detailSource === "mechanic" && Boolean(activeWorkorder);
  const isOfficeDetail = detailSource === "office" && Boolean(activeWorkorder);
  const isWorkorderDetail = Boolean(activeWorkorder);
  const showEmbeddedPreview = !isWorkorderDetail || (previewPanelOpen && !isCompact);
  const conversationMessages = useMemo(() => {
    if (!activeWorkorder) return [];
    const officeNote = activeWorkorder.workorder.officeNotes
      ? [{
        id: "office-note",
        senderRole: "office",
        senderName: "Office",
        messageType: "normal",
        body: activeWorkorder.workorder.officeNotes,
        createdAt: null,
      }]
      : [];
    return [...officeNote, ...(activeWorkorder.messages || [])];
  }, [activeWorkorder]);
  const filledPartCount = form.parts.filter((part) => part.partNo || part.qty || part.repairOrder).length;
  const mechanicAsset = activeWorkorder?.workorder?.asset || {};
  const mechanicUnitType = form.unitType || mechanicAsset.unitType || "Vehicle";
  const mechanicVehicleLabel = [
    mechanicAsset.year,
    mechanicAsset.make,
    mechanicAsset.model,
  ].filter(Boolean).join(" ") || form.model || "Not listed";
  const mechanicMapVehicle = selectedVehicle || mechanicAsset;
  const mechanicMapLocation = vehicleLocation(mechanicMapVehicle);
  const assignedMechanicIds = activeWorkorder?.workorder?.mechanics?.map((mechanic) => mechanic.id)
    || (activeWorkorder?.workorder?.mechanic?.id ? [activeWorkorder.workorder.mechanic.id] : []);
  const officeAssignmentChanged = [...officeAssignment.mechanicUserIds].sort().join(",")
    !== [...assignedMechanicIds].sort().join(",");
  const expectedMechanicName = activeWorkorder?.user?.name || actor.name || "";
  const mechanicFinishNameMatches = (
    mechanicFinish.name.trim().replace(/\s+/g, " ").toLowerCase()
    === expectedMechanicName.trim().replace(/\s+/g, " ").toLowerCase()
  );

  useEffect(() => {
    if (!isMechanicDetail || !activeWorkorder?.workorder?.id || !mechanicMapVehicle?.id) return;
    const refreshKey = `${activeWorkorder.workorder.id}:${mechanicMapVehicle.id}`;
    if (mechanicLocationRefreshRef.current === refreshKey) return;
    mechanicLocationRefreshRef.current = refreshKey;
    refreshVehicleLocation(mechanicMapVehicle);
  }, [activeWorkorder?.workorder?.id, isMechanicDetail, mechanicMapVehicle?.id]);

  async function refreshPrinters() {
    const result = await api("/api/printers");
    setPrinters(result.printers || []);
    const defaultPrinter = result.printers?.find((printer) => printer.isDefault);
    if (defaultPrinter) setForm((current) => ({ ...current, printerName: defaultPrinter.name }));
  }

  useEffect(() => {
    if (actor.role === "office" || actor.role === "admin") refreshPrinters().catch(() => {});
  }, [actor.role]);

  useEffect(() => {
    if (actor.role !== "office") return;
    api("/api/office/template")
      .then(({ location, template, locations }) => {
        setOfficeLocations(locations || []);
        if (!location) return;
        setForm((current) => ({
          ...current,
          locationId: location.id,
          companyName: location.name,
          ...(template ? {
            headerTitle: template.header_title,
            brandTop: template.brand_top,
            brandBottom: template.brand_bottom,
            warrantyText: template.warranty_text,
            responsibilityText: template.responsibility_text,
            authorizationText: template.authorization_text,
          } : {}),
        }));
      })
      .catch(() => {});
  }, [actor.role]);

  function selectOfficeLocation(locationId) {
    const selected = officeLocations.find((entry) => entry.location.id === locationId);
    if (!selected) return;
    setForm((current) => ({
      ...current,
      locationId: selected.location.id,
      companyName: selected.location.name,
      ...(selected.template ? {
        headerTitle: selected.template.header_title,
        brandTop: selected.template.brand_top,
        brandBottom: selected.template.brand_bottom,
        warrantyText: selected.template.warranty_text,
        responsibilityText: selected.template.responsibility_text,
        authorizationText: selected.template.authorization_text,
      } : {}),
    }));
  }

  useEffect(() => {
    api("/api/config")
      .then((result) => setMapsConfig(result.maps || {}))
      .catch(() => setMapsConfig({}));
  }, []);

  async function refreshSamsaraStatus() {
    try {
      const result = await api("/api/integrations/samsara/status");
      setSamsaraIntegration({
        loading: false,
        connected: result.authType === "oauth" && result.status === "connected",
        authType: result.authType || "none",
      });
    } catch {
      setSamsaraIntegration({ loading: false, connected: false, authType: "none" });
    }
  }

  useEffect(() => {
    if (actor.role === "admin") refreshSamsaraStatus();
    else setSamsaraIntegration({ loading: false, connected: false, authType: "none" });
  }, [actor.role]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const workorderId = params.get("workorder");
    if (!workorderId) return;
    const loadDetail = actor.role === "office" || actor.role === "admin"
      ? api(`/api/office/workorders/${encodeURIComponent(workorderId)}/opened`, {
        method: "POST",
        body: JSON.stringify({}),
      }).then(() => api(`/api/office/workorders/${encodeURIComponent(workorderId)}`)).then((detail) => {
        setActiveWorkorder(detail);
        setOfficeAssignment({
          mechanicUserIds: detail.workorder.mechanics?.map((mechanic) => mechanic.id)
            || (detail.workorder.mechanic?.id ? [detail.workorder.mechanic.id] : []),
          reason: "",
        });
        setPreviewPanelOpen(true);
        setDetailSource("office");
        setMode("admin");
        setDetailStatus(detail.workorder.status);
        setOpenSection("chat");
        setForm((current) => workorderFormValues(detail, current));
      })
      : actor.role === "mechanic"
        ? api(`/api/mechanic/workorders/${encodeURIComponent(workorderId)}/opened`, {
          method: "POST",
          body: JSON.stringify({}),
        }).then(() => api(`/api/mechanic/workorders/${encodeURIComponent(workorderId)}`)).then(openOperationalWorkorder)
        : Promise.reject(new Error("This role opens workorders from its own queue."));
    loadDetail
      .catch(() => returnToRoleWorkspace())
      .finally(() => setRouteLoading(false));
    // The route is only hydrated on the initial page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor.role]);

  useEffect(() => {
    const phoneQuery = window.matchMedia("(max-width: 700px)");
    const compactQuery = window.matchMedia("(max-width: 1180px)");
    const syncPhone = () => setIsPhone(phoneQuery.matches);
    const syncCompact = () => setIsCompact(compactQuery.matches);
    syncPhone();
    syncCompact();
    phoneQuery.addEventListener("change", syncPhone);
    compactQuery.addEventListener("change", syncCompact);
    return () => {
      phoneQuery.removeEventListener("change", syncPhone);
      compactQuery.removeEventListener("change", syncCompact);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const samsara = params.get("samsara");
    if (!samsara) return;
    setVehicleLookup((current) => ({
      ...current,
      status: samsara === "connected" ? "Samsara connected. Vehicle list will sync automatically." : params.get("message") || "Samsara login failed.",
    }));
    if (samsara === "connected") {
      setSamsaraIntegration((current) => ({ ...current, connected: true, authType: "oauth", loading: false }));
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  useEffect(() => {
    setOpenSection((current) => {
      if (mode === "mechanic" && (current === "print" || current === "header" || current === "disclaimer" || !current)) return "vehicle";
      if (mode === "admin" && (current === "print" || !current)) return "vehicle";
      return current;
    });
  }, [mode]);

  useEffect(() => {
    setFullscreenPageIndex((current) => Math.min(current, Math.max(0, effectiveCopies - 1)));
  }, [effectiveCopies]);

  useEffect(() => {
    if (!previewFullscreen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setPreviewFullscreen(false);
      if (event.key === "ArrowLeft") setFullscreenPageIndex((current) => Math.max(0, current - 1));
      if (event.key === "ArrowRight") setFullscreenPageIndex((current) => Math.min(previewSerials.length - 1, current + 1));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [previewFullscreen, previewSerials.length]);

  useEffect(() => {
    if (!previewPanelOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setPreviewPanelOpen(false);
        setPrintMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewPanelOpen]);


  useEffect(() => {
    let cancelled = false;
    const q = form.unitNo.trim();
    if (q.length < 2) {
      setVehicleLookup((current) => ({ ...current, loading: false, results: [] }));
      return;
    }

    setVehicleLookup((current) => ({ ...current, loading: true }));
    const timer = setTimeout(() => {
      api(`/api/vehicles/search?q=${encodeURIComponent(q)}&limit=8`)
        .then((result) => {
          if (!cancelled) {
            setVehicleLookup((current) => ({
              ...current,
              loading: false,
              status: result.vehicles?.length ? "Samsara vehicle data found." : "No vehicle match. Manual entry still works.",
              results: result.vehicles || [],
            }));
          }
        })
        .catch((error) => {
          if (!cancelled) setVehicleLookup((current) => ({ ...current, loading: false, status: error.message, results: [] }));
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form.unitNo]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateStartDate(value) {
    setForm((current) => ({
      ...current,
      workDate: value,
      workStartDate: value,
      workEndDate: !current.workEndDate || current.workEndDate < value ? value : current.workEndDate,
    }));
  }

  function updatePart(index, field, value) {
    setForm((current) => ({
      ...current,
      parts: current.parts.map((part, partIndex) => (partIndex === index ? { ...part, [field]: value } : part)),
    }));
  }

  function addPartRow() {
    setForm((current) => ({ ...current, parts: [...current.parts, emptyPart()] }));
  }

  function removePartRow(index) {
    setForm((current) => ({
      ...current,
      parts: current.parts.length <= 1 ? current.parts : current.parts.filter((_, partIndex) => partIndex !== index),
    }));
  }

  function updateActiveUsedParts(parts) {
    setForm((current) => ({ ...current, parts }));
  }

  async function saveActiveUsedParts(parts) {
    const workorderId = activeWorkorder?.workorder?.id;
    if (!workorderId) throw new Error("Open a workorder before saving parts.");

    if (isOfficeDetail) {
      await api(`/api/office/workorders/${workorderId}`, {
        method: "PATCH",
        body: JSON.stringify({
          formData: {
            ...(activeWorkorder.workorder.formData || {}),
            parts,
          },
        }),
      });
    } else {
      const mechanicRows = parts.filter((part) => !part.requestId);
      await api(`/api/mechanic/workorders/${workorderId}/used-parts`, {
        method: "PATCH",
        body: JSON.stringify({ parts: mechanicRows }),
      });
    }

    setActiveWorkorder((current) => current ? {
      ...current,
      workorder: {
        ...current.workorder,
        formData: { ...(current.workorder.formData || {}), parts },
      },
    } : current);
  }

  function vehicleMileage(vehicle) {
    if (vehicle.last_odometer_miles) return String(Math.round(Number(vehicle.last_odometer_miles)));
    if (vehicle.last_odometer_meters) return String(Math.round(Number(vehicle.last_odometer_meters) / 1609.344));
    return "";
  }

  function vehicleModelText(vehicle) {
    const seen = new Set();
    return [vehicle.year, vehicle.make, vehicle.model]
      .filter(Boolean)
      .filter((value) => {
        const key = String(value).trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .join(" ");
  }

  function vehicleLocation(vehicle) {
    const gps = vehicle?.lastLocation || vehicle?.last_location || null;
    const latitude = Number(gps?.latitude);
    const longitude = Number(gps?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return {
      latitude,
      longitude,
      address: gps?.reverseGeo?.formattedLocation || gps?.address?.name || "",
      time: gps?.time || vehicle?.lastSeenAt || vehicle?.last_seen_at || "",
      speed: gps?.speedMilesPerHour,
    };
  }

  function applyVehicle(vehicle) {
    const modelText = vehicleModelText(vehicle);
    setForm((current) => ({
      ...current,
      companyName: vehicle.owner_name || current.companyName,
      unitNo: vehicle.unit_no || vehicle.name || current.unitNo,
      unitType: vehicle.unit_type || current.unitType,
      licenseNo: vehicle.license_plate || current.licenseNo,
      mileage: vehicleMileage(vehicle) || current.mileage,
      model: modelText || current.model,
      vinNo: vehicle.vin || current.vinNo,
    }));
    setVehicleLookup((current) => ({
      ...current,
      status: `${vehicle.unit_no || vehicle.name || "Vehicle"} applied from Samsara.`,
      results: [],
    }));
    setSelectedVehicle(vehicle);
    refreshVehicleLocation(vehicle);
  }

  async function refreshVehicleLocation(vehicle = selectedVehicle) {
    if (!vehicle?.id || locationLoading) return;
    setLocationLoading(true);
    try {
      const result = await api(`/api/vehicles/${encodeURIComponent(vehicle.id)}/live-location`, { method: "POST" });
      setSelectedVehicle(result.vehicle);
    } catch (error) {
      setVehicleLookup((current) => ({ ...current, status: error.message }));
    } finally {
      setLocationLoading(false);
    }
  }

  async function syncSamsaraVehicles() {
    setVehicleLookup((current) => ({ ...current, syncing: true, status: "Syncing Samsara vehicles..." }));
    try {
      const result = await api("/api/integrations/samsara/sync", { method: "POST" });
      setVehicleLookup((current) => ({
        ...current,
        syncing: false,
        status: result.status === "completed" ? `Synced ${result.fetched_count} vehicle(s).` : result.error || "Samsara sync failed.",
      }));
      refreshSamsaraStatus();
    } catch (error) {
      setVehicleLookup((current) => ({ ...current, syncing: false, status: error.message }));
      refreshSamsaraStatus();
    }
  }

  function connectSamsara() {
    window.location.href = "/api/integrations/samsara/oauth/start";
  }

  async function printWorkorders(destination = form.printerName) {
    setPrintState({ open: true, stage: "allocating", message: "Locking serial numbers so duplicates cannot be generated.", printerName: destination });
    try {
      await new Promise((resolve) => setTimeout(resolve, 450));
      setPrintState({ open: true, stage: "rendering", message: mode === "mechanic" ? "Rendering one workorder." : "Rendering workorder pages with first-to-last serial range.", printerName: destination });
      await new Promise((resolve) => setTimeout(resolve, 450));
      setPrintState({ open: true, stage: "printing", message: destination ? "Sending PDF to selected printer." : "Saving generated PDF.", printerName: destination });
      const result = await api("/api/print", {
        method: "POST",
        body: JSON.stringify({
          companyName: form.companyName,
          prefix: form.prefix,
          nextNumber: Number(form.nextNumber),
          digits: Number(form.digits),
          count: effectiveCopies,
          printerName: destination,
          form: {
            companyName: form.companyName,
            headerTitle: form.headerTitle,
            brandTop: form.brandTop,
            brandBottom: form.brandBottom,
            warrantyText: form.warrantyText,
            responsibilityText: form.responsibilityText,
            authorizationText: form.authorizationText,
            workDate: form.workDate,
            workStartDate: form.workStartDate,
            workEndDate: form.workEndDate,
            unitNo: form.unitNo,
            unitType: form.unitType,
            licenseNo: form.licenseNo,
            mileage: form.mileage,
            model: form.model,
            vinNo: form.vinNo,
            mechanicConcern: form.mechanicConcern,
            mechanicName: form.mechanicName,
            startTime: form.startTime,
            endTime: form.endTime,
            managerName: form.managerName,
            customerSignature: form.customerSignature,
            authorizedBy: form.authorizedBy,
            parts: form.parts,
          },
        }),
      });
      setForm((current) => ({ ...current, nextNumber: result.nextNumber }));
      setPrintState({
        open: true,
        stage: "done",
        message: result.printerName ? "Sent to printer. Serial numbers were saved in log." : "PDF is ready to download.",
        printerName: destination,
        downloadUrl: result.downloadUrl,
      });
    } catch (error) {
      setPrintState({ open: true, stage: "error", message: error.message, printerName: destination });
    }
  }

  async function createOfficeWorkorder() {
    const concern = form.mechanicConcern.trim();
    if (!concern) {
      setOfficeCreateState({ busy: false, message: "Mechanic concern is required before sending work to the queue." });
      setOpenSection("vehicle");
      return;
    }
    setOfficeCreateState({ busy: true, message: "Creating workorder..." });
    try {
      const result = await api("/api/office/workorders", {
        method: "POST",
        body: JSON.stringify({
          companyId: actor.companyMemberships?.[0]?.companyId || actor.companyIds?.[0] || "",
          locationId: form.locationId || actor.locationIds?.[0] || null,
          assetId: selectedVehicle?.id || null,
          concern,
          officeNotes: "",
          formData: {
            companyName: form.companyName,
            headerTitle: form.headerTitle,
            brandTop: form.brandTop,
            brandBottom: form.brandBottom,
            warrantyText: form.warrantyText,
            responsibilityText: form.responsibilityText,
            authorizationText: form.authorizationText,
            workDate: form.workDate,
            workStartDate: form.workStartDate,
            workEndDate: form.workEndDate,
            unitNo: form.unitNo,
            unitType: form.unitType,
            licenseNo: form.licenseNo,
            mileage: form.mileage,
            model: form.model,
            vinNo: form.vinNo,
            mechanicConcern: form.mechanicConcern,
            mechanicName: form.mechanicName,
            startTime: form.startTime,
            endTime: form.endTime,
            managerName: form.managerName,
            customerSignature: form.customerSignature,
            authorizedBy: form.authorizedBy,
            parts: form.parts,
          },
        }),
      });
      setOfficeCreateState({ busy: false, message: `${result.workorder.serial} sent to mechanic available queue.` });
      setWorkspace("office");
      window.history.replaceState({}, "", window.location.pathname);
    } catch (error) {
      setOfficeCreateState({ busy: false, message: error.message });
    }
  }

  function selectPrintDestination(destination) {
    setPrintMenuOpen(false);
    setForm((current) => ({ ...current, printerName: destination }));
  }

  function workorderFormValues(detail, current = form) {
    const workorder = detail.workorder;
    const asset = workorder.asset || {};
    const savedForm = workorder.formData || {};
    const serial = splitSerial(workorder.serial);
    const model = [asset.year, asset.make, asset.model].filter(Boolean).join(" ");
    const savedParts = Array.isArray(savedForm.parts) && savedForm.parts.length
      ? savedForm.parts
      : [emptyPart(), emptyPart(), emptyPart()];
    const assignedMechanicName = workorder.mechanics?.map((mechanic) => mechanic.name).filter(Boolean).join(", ")
      || workorder.mechanic?.name
      || (detail.user?.role === "mechanic" ? detail.user.name : "");

    return {
      ...current,
      ...savedForm,
      ...serial,
      copies: 1,
      companyName: savedForm.companyName || workorder.location?.name || current.companyName,
      unitNo: savedForm.unitNo || asset.unitNo || asset.name || "",
      unitType: savedForm.unitType || asset.unitType || "",
      licenseNo: savedForm.licenseNo || asset.licensePlate || "",
      mileage: savedForm.mileage || (asset.lastOdometerMiles ? String(Math.round(Number(asset.lastOdometerMiles))) : ""),
      model: savedForm.model || model,
      vinNo: savedForm.vinNo || asset.vin || "",
      mechanicConcern: savedForm.mechanicConcern || workorder.concern || "",
      mechanicName: assignedMechanicName || savedForm.mechanicName,
      officeNotes: workorder.officeNotes || savedForm.officeNotes || "",
      parts: savedParts,
    };
  }

  function openOperationalWorkorder(detail) {
    const workorder = detail.workorder;
    mechanicLocationRefreshRef.current = "";
    setMechanicTruckDetailsOpen(false);
    setActiveWorkorder(detail);
    setPreviewPanelOpen(true);
    setDetailSource("mechanic");
    setMode("mechanic");
    setDetailStatus(workorder.status);
    setSelectedVehicle(workorder.asset || null);
    setMechanicAction({ busy: "", message: "" });
    setOpenSection("chat");
    setForm((current) => workorderFormValues(detail, current));
    setWorkspace("generator");
    window.history.replaceState({}, "", `${window.location.pathname}?workorder=${encodeURIComponent(workorder.id)}`);
  }

  async function openOfficeWorkorder(workorderId) {
    setOfficeDetailState({ busy: true, message: "" });
    try {
      await api(`/api/office/workorders/${encodeURIComponent(workorderId)}/opened`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const detail = await api(`/api/office/workorders/${encodeURIComponent(workorderId)}`);
      const workorder = detail.workorder;
      setActiveWorkorder(detail);
      setOfficeAssignment({
        mechanicUserIds: workorder.mechanics?.map((mechanic) => mechanic.id)
          || (workorder.mechanic?.id ? [workorder.mechanic.id] : []),
        reason: "",
      });
      setPreviewPanelOpen(true);
      setDetailSource("office");
      setMode("admin");
      setDetailStatus(workorder.status);
      setOpenSection("chat");
      setForm((current) => workorderFormValues(detail, current));
      setWorkspace("generator");
      setOfficeDetailState({ busy: false, message: "" });
      window.history.replaceState({}, "", `${window.location.pathname}?workorder=${encodeURIComponent(workorder.id)}`);
    } catch (error) {
      setOfficeDetailState({ busy: false, message: error.message });
    }
  }

  async function saveOfficeWorkorder() {
    if (!activeWorkorder?.workorder || !isOfficeDetail) return;
    setOfficeDetailState({ busy: true, message: "Saving..." });
    try {
      const formData = {
        ...(activeWorkorder.workorder.formData || {}),
        companyName: form.companyName,
        headerTitle: form.headerTitle,
        brandTop: form.brandTop,
        brandBottom: form.brandBottom,
        warrantyText: form.warrantyText,
        responsibilityText: form.responsibilityText,
        authorizationText: form.authorizationText,
        workDate: form.workDate,
        workStartDate: form.workStartDate,
        workEndDate: form.workEndDate,
        unitNo: form.unitNo,
        unitType: form.unitType,
        licenseNo: form.licenseNo,
        mileage: form.mileage,
        model: form.model,
        vinNo: form.vinNo,
        mechanicConcern: form.mechanicConcern,
        mechanicName: form.mechanicName,
        startTime: form.startTime,
        endTime: form.endTime,
        managerName: form.managerName,
        customerSignature: form.customerSignature,
        authorizedBy: form.authorizedBy,
        parts: form.parts,
      };
      const result = await api(`/api/office/workorders/${activeWorkorder.workorder.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          concern: form.mechanicConcern,
          officeNotes: form.officeNotes || "",
          formData,
        }),
      });
      const detail = await api(`/api/office/workorders/${result.workorder.id}`);
      setActiveWorkorder(detail);
      setDetailStatus(detail.workorder.status);
      setForm((current) => workorderFormValues(detail, current));
      setOfficeDetailState({ busy: false, message: "Saved. Mechanic view will update from this record." });
    } catch (error) {
      setOfficeDetailState({ busy: false, message: error.message });
    }
  }

  async function closeOfficeWorkorder(event) {
    event.preventDefault();
    if (!activeWorkorder?.workorder || !isOfficeDetail) return;
    setOfficeDetailState({ busy: true, message: "" });
    try {
      await api(`/api/office/workorders/${activeWorkorder.workorder.id}/close`, {
        method: "POST",
        body: JSON.stringify({ note: officeCloseNote }),
      });
      const detail = await api(`/api/office/workorders/${activeWorkorder.workorder.id}`);
      setActiveWorkorder(detail);
      setDetailStatus(detail.workorder.status);
      setForm((current) => workorderFormValues(detail, current));
      setOfficeCloseOpen(false);
      setOfficeCloseNote("");
      setOfficeDetailState({ busy: false, message: "Workorder closed." });
    } catch (error) {
      setOfficeDetailState({ busy: false, message: error.message });
    }
  }

  async function updateOfficeMechanicTeam() {
    if (!activeWorkorder?.workorder || !isOfficeDetail) return;
    const reason = officeAssignment.reason.trim();
    if (!reason) {
      setOfficeDetailState({ busy: false, message: "Add a reason before changing the mechanic team." });
      return;
    }
    setOfficeDetailState({ busy: true, message: "Updating assignment..." });
    try {
      await api(`/api/office/workorders/${activeWorkorder.workorder.id}/assignments`, {
        method: "POST",
        body: JSON.stringify({
          mechanicUserIds: officeAssignment.mechanicUserIds,
          reason,
        }),
      });
      const detail = await api(`/api/office/workorders/${activeWorkorder.workorder.id}`);
      setActiveWorkorder(detail);
      setDetailStatus(detail.workorder.status);
      setForm((current) => workorderFormValues(detail, current));
      const team = detail.workorder.mechanics || [];
      setOfficeAssignment({ mechanicUserIds: team.map((mechanic) => mechanic.id), reason: "" });
      setOfficeDetailState({
        busy: false,
        message: team.length
          ? `Assigned to ${team.map((mechanic) => mechanic.name).join(", ")}.`
          : "Workorder returned to the available queue.",
      });
    } catch (error) {
      setOfficeDetailState({ busy: false, message: error.message });
    }
  }

  function openOfficeGenerator() {
    setActiveWorkorder(null);
    setPreviewPanelOpen(false);
    setDetailSource(null);
    setMode("admin");
    setOpenSection("vehicle");
    setWorkspace("generator");
    window.history.replaceState({}, "", `${window.location.pathname}?view=create`);
  }

  function openOfficeWorkspace() {
    setActiveWorkorder(null);
    setPreviewPanelOpen(false);
    setDetailSource(null);
    setWorkspace(actor.role === "admin" ? "admin" : "office");
    window.history.replaceState({}, "", window.location.pathname);
  }

  function returnToRoleWorkspace() {
    if (actor.role === "admin" || actor.role === "office") {
      openOfficeWorkspace();
      return;
    }
    returnToMyWork();
  }

  function returnToMyWork() {
    setActiveWorkorder(null);
    setMechanicFinish({ open: false, name: "", message: "" });
    setPreviewPanelOpen(false);
    setDetailSource(null);
    setWorkspace("mechanic");
    window.history.replaceState({}, "", window.location.pathname);
  }

  async function runMechanicAction(name, request, successMessage, nextStatus) {
    if (!activeWorkorder) return;
    setMechanicAction({ busy: name, message: "" });
    try {
      const result = await request(activeWorkorder);
      const nextWorkorder = result?.workorder;
      const nextMessage = result?.message;
      if (nextWorkorder) {
        setActiveWorkorder((current) => ({ ...current, workorder: nextWorkorder }));
        setDetailStatus(nextWorkorder.status);
      } else if (nextMessage) {
        setActiveWorkorder((current) => ({
          ...current,
          messages: [
            ...(current?.messages || []),
            {
              ...nextMessage,
              senderName: nextMessage.senderName || current?.user?.name || "You",
            },
          ],
          workorder: nextStatus ? { ...current.workorder, status: nextStatus } : current.workorder,
        }));
        if (nextStatus) setDetailStatus(nextStatus);
      } else if (nextStatus) {
        setDetailStatus(nextStatus);
      }
      setMechanicAction({ busy: "", message: successMessage });
      return true;
    } catch (error) {
      setMechanicAction({ busy: "", message: error.message });
      return false;
    }
  }

  async function sendWorkorderChat({ body, attachment }) {
    const workorderId = activeWorkorder?.workorder?.id;
    if ((!body && !attachment) || !workorderId) return false;

    setMechanicAction({ busy: "chat", message: "" });
    try {
      const rolePath = isOfficeDetail ? "office" : "mechanic";
      await api(`/api/${rolePath}/workorders/${workorderId}/messages`, {
        method: "POST",
        body: JSON.stringify({ body, ...(attachment ? { attachment } : {}) }),
      });
      await reloadActiveWorkorder();
      setMechanicAction({ busy: "", message: "Message sent." });
      return true;
    } catch (error) {
      setMechanicAction({ busy: "", message: error.message });
      return false;
    }
  }

  async function reloadActiveWorkorder() {
    const workorderId = activeWorkorder?.workorder?.id;
    if (!workorderId) return;
    const detail = isOfficeDetail
      ? await api(`/api/office/workorders/${encodeURIComponent(workorderId)}`)
      : await api(`/api/mechanic/workorders/${encodeURIComponent(workorderId)}`);
    setActiveWorkorder(detail);
    setDetailStatus(detail.workorder.status);
    setForm((current) => workorderFormValues(detail, current));
  }

  useEffect(() => {
    if (mode !== "mechanic" || !activeWorkorder?.workorder?.id) return undefined;
    const workorderId = activeWorkorder.workorder.id;
    let cancelled = false;
    const refreshDetail = async () => {
      try {
        const detail = await api(`/api/mechanic/workorders/${encodeURIComponent(workorderId)}`);
        if (cancelled) return;
        setActiveWorkorder(detail);
        setDetailStatus(detail.workorder.status);
        setForm((current) => workorderFormValues(detail, current));
      } catch {
        // Keep the current detail visible; dashboard refresh handles missing workorders.
      }
    };
    const interval = window.setInterval(refreshDetail, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeWorkorder?.workorder?.id, mode]);

  function markMechanicWorkDone(confirmationName) {
    const repairOrders = form.parts
      .map((part) => String(part.repairOrder || "").trim())
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .join("\n");
    return runMechanicAction(
      "done",
      (detail) => api(`/api/mechanic/workorders/${detail.workorder.id}/mark-done`, {
        method: "POST",
        body: JSON.stringify({
          diagnosis: form.mechanicConcern,
          workPerformed: repairOrders,
          confirmationName,
        }),
      }),
      "Work sent to office for review.",
    );
  }

  async function submitMechanicFinish(event) {
    event.preventDefault();
    if (!mechanicFinishNameMatches) {
      setMechanicFinish((current) => ({
        ...current,
        message: `Write ${expectedMechanicName} to finish this workorder.`,
      }));
      return;
    }
    const finished = await markMechanicWorkDone(mechanicFinish.name);
    if (finished) setMechanicFinish({ open: false, name: "", message: "" });
  }

  function toggleSection(section) {
    setOpenSection((current) => (current === section ? "" : section));
  }

  function openMechanicSection(section) {
    setOpenSection(section);
    window.requestAnimationFrame(() => {
      document.getElementById(`mechanic-${section}-section`)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function jumpToPreview() {
    if (isWorkorderDetail) {
      if (isCompact) {
        setFullscreenPageIndex(0);
        setFullscreenZoom(isPhone ? 0 : 1);
        setPreviewFullscreen(true);
      } else {
        setPreviewPanelOpen((open) => {
          if (open) setPrintMenuOpen(false);
          return !open;
        });
      }
      return;
    }
    previewGridRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function openFullscreenPreview() {
    setPrintMenuOpen(false);
    setFullscreenPageIndex(0);
    setFullscreenZoom(isPhone ? 0 : 1);
    setPreviewFullscreen(true);
  }

  if (routeLoading) {
    return (
      <main className="prototype mechanic-home route-loading">
        <div className="mechanic-empty-state">
          <RefreshCw01 className="loading-icon" />
          <strong>Opening workorder...</strong>
        </div>
      </main>
    );
  }

  if (workspace === "mechanic") {
    return <MechanicWorkspace actor={actor} onOpenWorkorder={openOperationalWorkorder} />;
  }

  if (workspace === "admin") {
    return (
      <Suspense fallback={null}>
        <AdminWorkspace actor={actor} onCreateWorkorder={openOfficeGenerator} onOpenWorkorder={openOfficeWorkorder} />
      </Suspense>
    );
  }

  if (workspace === "office") {
    return <OfficeWorkspace actor={actor} onCreateWorkorder={openOfficeGenerator} onOpenWorkorder={openOfficeWorkorder} />;
  }

  if (workspace === "surveillance") {
    return <SurveillanceWorkspace actor={actor} />;
  }

  return (
    <main className={`prototype ${isWorkorderDetail ? "workorder-detail-page" : ""} ${isMechanicDetail ? "mechanic-detail-page" : ""}`.trim()}>
      <style>{workorderTemplateStyles}</style>
      <WorkorderDetailLayout detail={isWorkorderDetail} previewOpen={showEmbeddedPreview}>
        <aside className="control-panel" ref={formRef}>
          {activeWorkorder ? (
            <div className="detail-context-bar">
              <button
                type="button"
                onClick={returnToRoleWorkspace}
                aria-label={actor.role === "admin" ? "Back to Operations" : isOfficeDetail ? "Back to Office" : "Back to My Work"}
                title={actor.role === "admin" ? "Back to Operations" : isOfficeDetail ? "Back to Office" : "Back to My Work"}
              >
                <ArrowLeft />
              </button>
              <div>
                <strong>{activeWorkorder.workorder.asset?.unitNo || activeWorkorder.workorder.asset?.name || "Workorder"}</strong>
                <span>{activeWorkorder.workorder.serial}</span>
              </div>
              <div className="detail-context-actions">
                <WorkorderStatusPill status={detailStatus} label={currentStatusLabel} />
                {isOfficeDetail ? (
                  <button
                    className="detail-save-button"
                    type="button"
                    onClick={saveOfficeWorkorder}
                    disabled={officeDetailState.busy}
                    aria-label={officeDetailState.busy ? "Saving workorder" : "Save workorder"}
                    title={officeDetailState.busy ? "Saving workorder" : "Save workorder"}
                  >
                    <Save01 />
                  </button>
                ) : null}
                {isOfficeDetail && detailStatus === "mechanic_done" ? (
                  <button
                    className="detail-close-workorder-button"
                    type="button"
                    onClick={() => {
                      setOfficeDetailState((current) => ({ ...current, message: "" }));
                      setOfficeCloseOpen(true);
                    }}
                    disabled={officeDetailState.busy}
                    aria-label="Close workorder"
                    title="Close workorder"
                  >
                    <CheckCircle />
                    <span>Close</span>
                  </button>
                ) : null}
                {!isMechanicDetail ? (
                  <PreviewToggle open={showEmbeddedPreview || previewFullscreen} onToggle={jumpToPreview} controls="workorder-preview-panel" />
                ) : null}
              </div>
            </div>
          ) : (
            <div className="detail-context-bar office-create-nav">
              <button type="button" onClick={openOfficeWorkspace} aria-label="Back to Office" title="Back to Office">
                <ArrowLeft />
              </button>
              <div>
                <strong>Create workorder</strong>
                <span>Office queue</span>
              </div>
              <div className="detail-context-actions">
                <button
                  className="detail-create-button"
                  type="button"
                  onClick={createOfficeWorkorder}
                  disabled={officeCreateState.busy}
                  aria-label={officeCreateState.busy ? "Creating workorder" : "Create workorder"}
                  title={officeCreateState.busy ? "Creating workorder" : "Create workorder"}
                >
                  <span>{officeCreateState.busy ? "Creating" : "Create"}</span>
                </button>
                <PreviewToggle open={showEmbeddedPreview || previewFullscreen} onToggle={jumpToPreview} controls="workorder-preview-panel" />
              </div>
            </div>
          )}

          {!isMechanicDetail ? (
            <div className="mobile-jumpbar" aria-label="Phone shortcuts">
              <button type="button" onClick={() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                Form
              </button>
              <PreviewToggle open={showEmbeddedPreview || previewFullscreen} onToggle={jumpToPreview} controls="workorder-preview-panel" className="mobile-preview-pane-toggle" />
            </div>
          ) : null}

          {mode === "admin" && !activeWorkorder && officeCreateState.message ? (
            <p className="office-create-message" role="status">{officeCreateState.message}</p>
          ) : null}

          {mode === "mechanic" && !activeWorkorder ? (
            <div className="detail-status-card">
              <div>
                <span>Status</span>
                <strong>{currentStatusLabel}</strong>
              </div>
              <div>
                <span>Workorder</span>
                <strong>{firstSerial}</strong>
              </div>
            </div>
          ) : null}

          {isMechanicDetail ? (
            <section className="mechanic-job-overview" aria-labelledby="mechanic-job-title">
              <div className="mechanic-job-heading">
                <span>Work to do</span>
                <h1 id="mechanic-job-title">{form.mechanicConcern || "No repair concern listed"}</h1>
              </div>
              <div className="mechanic-job-facts">
                <div>
                  <span>{mechanicUnitType}</span>
                  <strong>{form.unitNo || mechanicAsset.unitNo || mechanicAsset.name || "Not listed"}</strong>
                </div>
                <div>
                  <span>{mechanicUnitType} details</span>
                  <strong>{mechanicVehicleLabel}</strong>
                </div>
                <div>
                  <span>Mileage</span>
                  <strong>{form.mileage ? `${form.mileage} mi` : "Not listed"}</strong>
                </div>
              </div>
              <details
                className="mechanic-truck-details"
                open={mechanicTruckDetailsOpen}
                onToggle={(event) => setMechanicTruckDetailsOpen(event.currentTarget.open)}
              >
                <summary>More {mechanicUnitType.toLowerCase()} details</summary>
                <dl>
                  <div><dt>VIN</dt><dd>{form.vinNo || "Not listed"}</dd></div>
                  <div><dt>License</dt><dd>{form.licenseNo || "Not listed"}</dd></div>
                  <div><dt>Work dates</dt><dd>{workDateRangeLabel(form) || "Not listed"}</dd></div>
                  <div><dt>Workorder</dt><dd>{activeWorkorder.workorder.serial}</dd></div>
                </dl>
                <AssetLocationCard
                  vehicle={mechanicMapVehicle}
                  location={mechanicMapLocation}
                  mapsConfig={mapsConfig}
                  showRefresh={false}
                  showVehicleLabel={false}
                />
              </details>
              <div className="mechanic-job-actions" aria-label="Workorder actions">
                <button
                  type="button"
                  onClick={jumpToPreview}
                  aria-controls="workorder-preview-panel"
                  aria-expanded={showEmbeddedPreview || previewFullscreen}
                >
                  <FileSearch01 />
                  <span>{showEmbeddedPreview || previewFullscreen ? "Hide workorder" : "View workorder"}</span>
                </button>
                <button type="button" onClick={() => openMechanicSection("chat")}>
                  <MessageChatCircle />
                  <span>Message office</span>
                </button>
                <button type="button" onClick={() => openMechanicSection("parts")}>
                  <Package />
                  <span>Parts used</span>
                </button>
                <button
                  className="finish-work-button"
                  type="button"
                  onClick={() => setMechanicFinish({ open: true, name: "", message: "" })}
                  disabled={!activeWorkorder?.allowedActions.markDone || Boolean(mechanicAction.busy)}
                >
                  <CheckCircle />
                  <span>{mechanicAction.busy === "done" ? "Finishing" : "Finish work"}</span>
                </button>
              </div>
              {mechanicAction.message ? <p className="mechanic-action-message" role="status">{mechanicAction.message}</p> : null}
            </section>
          ) : null}

          <div className="accordion-stack">
            {activeWorkorder ? (
              <div id={isMechanicDetail ? "mechanic-chat-section" : undefined} className={`editor-section chat-section ${isMechanicDetail ? "mechanic-primary-section" : ""} ${openSection === "chat" ? "is-open" : ""}`}>
                <button className="editor-summary" type="button" aria-expanded={openSection === "chat"} onClick={() => toggleSection("chat")}>
                  <span>{isOfficeDetail ? "Chat with mechanic" : "Messages with office"}</span>
                  <small>{conversationMessages.length} {conversationMessages.length === 1 ? "message" : "messages"}</small>
                </button>
                <div className="section-content chat-content">
                  <ChatThread messages={conversationMessages} currentRole={isOfficeDetail ? "office" : "mechanic"} currentUserId={actor.id} />
                  {isWorkorderDetail ? (
                    <ChatComposer
                      onSend={sendWorkorderChat}
                      disabled={isMechanicDetail && !activeWorkorder.allowedActions.sendMessage}
                      sending={mechanicAction.busy === "chat"}
                      placeholder={isOfficeDetail ? "Message mechanic..." : "Type a message to office..."}
                      textareaLabel={isOfficeDetail ? "Message mechanic" : "Message office"}
                      cameraLabel={isOfficeDetail ? "Take or add photo" : "Take photo"}
                      sendLabel="Send"
                      compact={isMechanicDetail}
                    />
                  ) : null}
                  {mechanicAction.message ? <p className="mechanic-action-message" role="status">{mechanicAction.message}</p> : null}
                </div>
              </div>
            ) : null}

            {activeWorkorder && !isMechanicDetail && !showEmbeddedPreview ? (
              <WorkorderTimelinePanel
                timeline={activeWorkorder.timeline || []}
                participants={activeWorkorder.participants || []}
                className="is-control-timeline"
              />
            ) : null}

            {isOfficeDetail ? (
              <div className={`editor-section ${openSection === "office" ? "is-open" : ""}`}>
                <button className="editor-summary" type="button" aria-expanded={openSection === "office"} onClick={() => toggleSection("office")}>
                  <span>Office</span>
                  <small>{officeDetailState.message || "Notes / save"}</small>
                </button>
                <div className="section-content">
                  <Field label="Office notes">
                    <textarea value={form.officeNotes} onChange={(event) => updateField("officeNotes", event.target.value)} rows="3" />
                  </Field>
                  <Button variant="primary" onClick={saveOfficeWorkorder} disabled={officeDetailState.busy}>
                    {officeDetailState.busy ? "Saving" : "Save changes"}
                  </Button>
                  {officeDetailState.message ? <p className="mechanic-action-message" role="status">{officeDetailState.message}</p> : null}
                </div>
              </div>
            ) : null}

            <div id={isMechanicDetail ? "mechanic-parts-section" : undefined} className={`editor-section ${isMechanicDetail ? "mechanic-primary-section" : ""} ${openSection === "parts" ? "is-open" : ""}`}>
              <button className="editor-summary" type="button" aria-expanded={openSection === "parts"} onClick={() => toggleSection("parts")}>
                <span>{isMechanicDetail ? "Parts used" : "Parts"}</span>
                <small>{isMechanicDetail ? `${filledPartCount} added` : `${form.parts.length} row(s)`}</small>
              </button>
              <div className="section-content">
                {activeWorkorder ? (
                  <PartRequestsPanel
                    role={isOfficeDetail ? "office" : "mechanic"}
                    detail={activeWorkorder}
                    parts={form.parts}
                    onPartsChange={updateActiveUsedParts}
                    onSaveParts={saveActiveUsedParts}
                    onChanged={reloadActiveWorkorder}
                  />
                ) : (
                  <>
                    <div className="parts-editor">
                      <div className="part-row part-row-head">
                        <span>S.No</span>
                        <span>Part no.</span>
                        <span>Qty</span>
                        <span>Repair order</span>
                        <span></span>
                      </div>
                      {form.parts.map((part, index) => (
                        <div className="part-row" key={index}>
                          <strong>{index + 1}</strong>
                          <input value={part.partNo} onChange={(event) => updatePart(index, "partNo", event.target.value)} aria-label={`Part number ${index + 1}`} placeholder="Part no." />
                          <input value={part.qty} onChange={(event) => updatePart(index, "qty", event.target.value)} aria-label={`Quantity ${index + 1}`} placeholder="Qty" />
                          <input value={part.repairOrder} onChange={(event) => updatePart(index, "repairOrder", event.target.value)} aria-label={`Repair order ${index + 1}`} placeholder="Repair order" />
                          <button className="remove-row" type="button" onClick={() => removePartRow(index)} disabled={form.parts.length <= 1}>
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                    <Button onClick={addPartRow}>Add part row</Button>
                  </>
                )}
              </div>
            </div>

            {actor.role === "admin" && !activeWorkorder ? (
              <div className={`editor-section ${openSection === "header" ? "is-open" : ""}`}>
              <button className="editor-summary" type="button" aria-expanded={openSection === "header"} onClick={() => toggleSection("header")}>
                <span>Header</span>
                <small>{form.companyName}</small>
              </button>
              <div className="section-content">
                <Field label="Header title">
                  <input value={form.headerTitle} onChange={(event) => updateField("headerTitle", event.target.value)} />
                </Field>
                <div className="two-col">
                  <Field label="Brand top">
                    <input value={form.brandTop} onChange={(event) => updateField("brandTop", event.target.value)} />
                  </Field>
                  <Field label="Brand bottom">
                    <input value={form.brandBottom} onChange={(event) => updateField("brandBottom", event.target.value)} />
                  </Field>
                </div>
              </div>
              </div>
            ) : null}

            <div className={`editor-section ${isMechanicDetail ? "mechanic-secondary-admin-section" : ""} ${openSection === "vehicle" ? "is-open" : ""}`}>
              <button className="editor-summary" type="button" aria-expanded={openSection === "vehicle"} onClick={() => toggleSection("vehicle")}>
                <span>{form.unitType || "Vehicle"}</span>
                <small>{form.unitNo || workDateRangeLabel(form)}</small>
              </button>
              <div className="section-content">
                {actor.role === "office" && officeLocations.length ? (
                  <Field label="Location">
                    <select value={form.locationId} onChange={(event) => selectOfficeLocation(event.target.value)}>
                      {officeLocations.map((entry) => <option key={entry.location.id} value={entry.location.id}>{entry.location.name}</option>)}
                    </select>
                  </Field>
                ) : null}
                {actor.role === "admin" ? (
                  <div className="vehicle-sync-row">
                    <SamsaraActionButton
                      connected={samsaraIntegration.connected}
                      syncing={vehicleLookup.syncing || samsaraIntegration.loading}
                      onConnect={connectSamsara}
                      onSync={syncSamsaraVehicles}
                    />
                  </div>
                ) : null}
                <div className="two-col">
                  <div className="unit-field-wrap">
                    <label className="field">
                      <span className="field-label-row">
                        Unit no.
                        <button
                          className="help-dot"
                          type="button"
                          aria-label="Unit lookup help"
                          title="Type a unit, truck name, VIN, or plate. Choose a Samsara match to fill VIN, mileage, license, and model."
                        >
                          ?
                        </button>
                      </span>
                      <input aria-label="Unit no." value={form.unitNo} onChange={(event) => updateField("unitNo", event.target.value)} autoComplete="off" />
                    </label>
                    {vehicleLookup.loading ? <p className="vehicle-inline-status">Searching...</p> : null}
                    {vehicleLookup.results.length ? (
                      <div className="vehicle-results">
	                        {vehicleLookup.results.map((vehicle) => (
	                          <button type="button" key={vehicle.id} onClick={() => applyVehicle(vehicle)}>
	                            <strong>{vehicle.unit_no || vehicle.name || vehicle.vin || "Unnamed vehicle"}</strong>
	                            <span>
	                              {[vehicle.unit_type, vehicle.owner_name, vehicleModelText(vehicle), vehicle.vin, vehicle.license_plate, vehicleMileage(vehicle) ? `${vehicleMileage(vehicle)} mi` : "", vehicleLocation(vehicle) ? "Map" : ""].filter(Boolean).join(" / ")}
	                            </span>
	                          </button>
	                        ))}
	                      </div>
	                    ) : null}
                  </div>
                </div>
                <div className="two-col">
                  <Field label="Start date">
                    <input type="date" value={form.workStartDate} onChange={(event) => updateStartDate(event.target.value)} />
                  </Field>
                  <Field label="End date">
                    <input type="date" value={form.workEndDate} min={form.workStartDate || undefined} onChange={(event) => updateField("workEndDate", event.target.value)} />
                  </Field>
                </div>
                <div className="two-col">
                  <Field label="Unit type">
                    <select value={form.unitType} onChange={(event) => updateField("unitType", event.target.value)}>
                      <option value="">Select type</option>
                      <option value="Truck">Truck</option>
                      <option value="Trailer">Trailer</option>
                      <option value="Other">Other</option>
                    </select>
                  </Field>
                  <Field label="License">
                    <input value={form.licenseNo} onChange={(event) => updateField("licenseNo", event.target.value)} />
                  </Field>
                </div>
	                <div className="two-col">
                  <Field label="Mileage">
                    <input value={form.mileage} onChange={(event) => updateField("mileage", event.target.value)} />
                  </Field>
	                  <Field label="Model">
	                    <input value={form.model} onChange={(event) => updateField("model", event.target.value)} />
	                  </Field>
                </div>
                <div className="two-col">
                  <Field label="Company name">
                    <input value={form.companyName} onChange={(event) => updateField("companyName", event.target.value)} />
                  </Field>
                  <Field label="VIN no.">
                    <input value={form.vinNo} onChange={(event) => updateField("vinNo", event.target.value)} />
                  </Field>
                </div>
                <AssetLocationCard
                  vehicle={selectedVehicle}
                  location={vehicleLocation(selectedVehicle)}
                  mapsConfig={mapsConfig}
                  loading={locationLoading}
                  onRefresh={() => refreshVehicleLocation(selectedVehicle)}
                />
                <Field label="Mechanic concern">
                  <input value={form.mechanicConcern} onChange={(event) => updateField("mechanicConcern", event.target.value)} />
                </Field>
              </div>
            </div>

            <div className={`editor-section ${isMechanicDetail ? "mechanic-secondary-admin-section" : ""} ${openSection === "mechanic" ? "is-open" : ""}`}>
              <button className="editor-summary" type="button" aria-expanded={openSection === "mechanic"} onClick={() => toggleSection("mechanic")}>
                <span>{isOfficeDetail ? "Mechanics" : "Mechanic"}</span>
                <small>{form.mechanicName || "Name / time"}</small>
              </button>
              <div className="section-content">
                {isOfficeDetail && !["closed", "odoo_entered"].includes(detailStatus) ? (
                  <div className="office-assignment-control">
                    <fieldset className="office-mechanic-team">
                      <legend>Assigned mechanics</legend>
                      {(activeWorkorder.assignableMechanics || []).map((mechanic) => {
                        const checked = officeAssignment.mechanicUserIds.includes(mechanic.id);
                        return (
                          <label key={mechanic.id}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setOfficeAssignment((current) => ({
                                ...current,
                                mechanicUserIds: checked
                                  ? current.mechanicUserIds.filter((id) => id !== mechanic.id)
                                  : [...current.mechanicUserIds, mechanic.id],
                              }))}
                            />
                            <span>{mechanic.name}</span>
                          </label>
                        );
                      })}
                      {!(activeWorkorder.assignableMechanics || []).length ? <p>No mechanics assigned to this location.</p> : null}
                    </fieldset>
                    <Field label="Assignment reason">
                      <input
                        aria-label="Assignment reason"
                        value={officeAssignment.reason}
                        onChange={(event) => setOfficeAssignment((current) => ({ ...current, reason: event.target.value }))}
                        placeholder="Why is the team changing?"
                      />
                    </Field>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={officeDetailState.busy || !officeAssignmentChanged}
                      onClick={updateOfficeMechanicTeam}
                    >
                      Update team
                    </Button>
                  </div>
                ) : null}
                <Field label="Mechanic name">
                  <input value={form.mechanicName} onChange={(event) => updateField("mechanicName", event.target.value)} />
                </Field>
                <div className="two-col">
                  <Field label="Start time">
                    <input type="time" value={form.startTime} onChange={(event) => updateField("startTime", event.target.value)} />
                  </Field>
                  <Field label="End time">
                    <input type="time" value={form.endTime} onChange={(event) => updateField("endTime", event.target.value)} />
                  </Field>
                </div>
                <div className="two-col">
                  <Field label="Customer sign">
                    <input value={form.customerSignature} onChange={(event) => updateField("customerSignature", event.target.value)} />
                  </Field>
                  <Field label="Authorized by">
                    <input value={form.authorizedBy} onChange={(event) => updateField("authorizedBy", event.target.value)} />
                  </Field>
                </div>
              </div>
            </div>

            {actor.role === "admin" && !activeWorkorder ? (
              <div className={`editor-section ${openSection === "disclaimer" ? "is-open" : ""}`}>
              <button className="editor-summary" type="button" aria-expanded={openSection === "disclaimer"} onClick={() => toggleSection("disclaimer")}>
                <span>Disclaimer</span>
                <small>Footer text</small>
              </button>
              <div className="section-content">
                <Field label="Warranty disclaimer">
                  <input value={form.warrantyText} onChange={(event) => updateField("warrantyText", event.target.value)} />
                </Field>
                <Field label="Responsibility disclaimer">
                  <textarea value={form.responsibilityText} onChange={(event) => updateField("responsibilityText", event.target.value)} rows="2" />
                </Field>
                <Field label="Authorization terms">
                  <textarea value={form.authorizationText} onChange={(event) => updateField("authorizationText", event.target.value)} rows="3" />
                </Field>
              </div>
              </div>
            ) : null}
          </div>
        </aside>

        <PreviewPane
          id="workorder-preview-panel"
          open={showEmbeddedPreview}
          variant={isWorkorderDetail ? "dock" : "full"}
          panelRef={previewRef}
          status={activeWorkorder ? <WorkorderStatusPill status={detailStatus} label={currentStatusLabel} /> : null}
          countLabel={workorderCountLabel}
          range={range}
          printMenuOpen={printMenuOpen}
          onTogglePrintMenu={() => setPrintMenuOpen((open) => !open)}
          onPrint={() => {
            setPrintMenuOpen(false);
            printWorkorders();
          }}
          primaryActionLabel={primaryActionLabel}
          selectedDestinationLabel={selectedDestinationLabel}
          printerName={form.printerName}
          printers={printers}
          onSelectPrintDestination={selectPrintDestination}
          batchSettings={mode === "admin" && !activeWorkorder ? {
            prefix: form.prefix,
            nextNumber: form.nextNumber,
            digits: form.digits,
            copies: form.copies,
            onChange: updateField,
          } : null}
          secondaryContent={activeWorkorder && showEmbeddedPreview && !isMechanicDetail ? (
            <WorkorderTimelinePanel
              timeline={activeWorkorder.timeline || []}
              participants={activeWorkorder.participants || []}
              className="is-preview-timeline"
            />
          ) : null}
          onFullscreen={openFullscreenPreview}
          onOpenPreview={isWorkorderDetail ? openFullscreenPreview : undefined}
        >
          <div ref={previewGridRef} className={`preview-grid ${effectiveCopies <= 1 ? "single" : ""} ${activeWorkorder ? "mechanic-preview-grid" : ""}`}>
            <WorkorderPreview label="First page" serial={firstSerial} form={form} />
            {effectiveCopies > 1 ? <WorkorderPreview label="Last page" serial={lastSerial} form={form} /> : null}
          </div>
        </PreviewPane>
      </WorkorderDetailLayout>

      <PreviewFullscreen
        open={previewFullscreen}
        form={form}
        serials={previewSerials}
        pageIndex={fullscreenPageIndex}
        zoom={fullscreenZoom}
        range={range}
        countLabel={workorderCountLabel}
        actionLabel={primaryActionLabel}
        destinationLabel={selectedDestinationLabel}
        onClose={() => setPreviewFullscreen(false)}
        onPageChange={setFullscreenPageIndex}
        onZoomChange={setFullscreenZoom}
        onPrint={() => {
          setPreviewFullscreen(false);
          printWorkorders();
        }}
      />
      <PrintModal state={printState} range={range} printerName={printState.printerName ?? form.printerName} onClose={() => setPrintState({ open: false, stage: "idle", message: "" })} />
      {mechanicFinish.open ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !mechanicAction.busy) {
              setMechanicFinish({ open: false, name: "", message: "" });
            }
          }}
        >
          <form className="mechanic-completion-modal" role="dialog" aria-modal="true" aria-label="Finish workorder" onSubmit={submitMechanicFinish}>
            <button
              className="close-button"
              type="button"
              onClick={() => setMechanicFinish({ open: false, name: "", message: "" })}
              disabled={Boolean(mechanicAction.busy)}
              aria-label="Cancel finishing workorder"
            >
              <XClose />
            </button>
            <h2>Finish workorder?</h2>
            <p>This sends the workorder to office for review. Write your name to confirm.</p>
            <Field label={`Write "${expectedMechanicName}"`}>
              <input
                type="text"
                value={mechanicFinish.name}
                onChange={(event) => setMechanicFinish({ open: true, name: event.target.value, message: "" })}
                placeholder={expectedMechanicName}
                autoComplete="off"
                autoFocus
              />
            </Field>
            {mechanicFinish.message ? <p className="mechanic-completion-message" role="alert">{mechanicFinish.message}</p> : null}
            <div className="mechanic-completion-actions">
              <Button
                variant="secondary"
                type="button"
                onClick={() => setMechanicFinish({ open: false, name: "", message: "" })}
                disabled={Boolean(mechanicAction.busy)}
              >
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={!mechanicFinishNameMatches || Boolean(mechanicAction.busy)}>
                {mechanicAction.busy === "done" ? "Finishing..." : "Finish workorder"}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
      {officeCloseOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOfficeCloseOpen(false)}>
          <form className="office-close-modal" role="dialog" aria-modal="true" aria-label="Close workorder" onSubmit={closeOfficeWorkorder}>
            <button className="close-button" type="button" onClick={() => setOfficeCloseOpen(false)} aria-label="Close review"><XClose /></button>
            <h2>Close workorder?</h2>
            <Field label="Office note (optional)">
              <textarea rows="3" value={officeCloseNote} onChange={(event) => setOfficeCloseNote(event.target.value)} placeholder="Add a final note" />
            </Field>
            {officeDetailState.message ? <p className="mechanic-completion-message" role="status">{officeDetailState.message}</p> : null}
            <div className="mechanic-completion-actions">
              <Button variant="secondary" type="button" onClick={() => setOfficeCloseOpen(false)}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={officeDetailState.busy}>{officeDetailState.busy ? "Closing..." : "Close workorder"}</Button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
