import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle, ClipboardCheck, Clock, Tool02 } from "@untitledui/icons";
import { api } from "../../../lib/api.js";
import { useAutomaticRefresh } from "../../../hooks/useAutomaticRefresh.js";
import { useWorkorderPreferences } from "../../../hooks/useWorkorderPreferences.js";
import { workorderMatchesSearch } from "../../../components/workorders/WorkorderQueue.jsx";
import {
  activeDatePreset,
  buildCompactSurveillanceTabs,
  buildSurveillanceTabs,
  dateInputValue,
  datePresetRange,
  matchesDateFilter,
  surveillanceLocations,
  SURVEILLANCE_QUEUE_KEYS,
} from "./surveillance-workspace-model.js";

function isCompactViewport() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;
}

export function useSurveillanceQueue() {
  const [dashboard, setDashboard] = useState(null);
  const [activeTab, setActiveTab] = useState("active");
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [dateStartFilter, setDateStartFilter] = useState("");
  const [dateEndFilter, setDateEndFilter] = useState("");
  const [customDateOpen, setCustomDateOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const preferenceHydrated = useRef(false);
  const compactQueueDefaultApplied = useRef(false);
  const queuePreferences = useWorkorderPreferences("surveillance");

  async function loadDashboard() {
    setError("");
    try {
      const result = await api("/api/surveillance/dashboard");
      setDashboard(result);
      return result;
    } catch (loadError) {
      setError(loadError.message);
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadDashboard(); }, []);
  useAutomaticRefresh(loadDashboard);

  useEffect(() => {
    if (!queuePreferences.ready || preferenceHydrated.current) return;
    const saved = queuePreferences.filters;
    if (SURVEILLANCE_QUEUE_KEYS.includes(saved.activeTab)) setActiveTab(saved.activeTab);
    setLocationFilter(saved.locationFilter || "");
    setDateStartFilter(saved.dateStartFilter || saved.dateFilter || "");
    setDateEndFilter(saved.dateEndFilter || "");
    preferenceHydrated.current = true;
  }, [queuePreferences.ready]);

  useEffect(() => {
    if (!preferenceHydrated.current) return;
    queuePreferences.save(
      { activeTab, locationFilter, dateFilter: dateStartFilter, dateStartFilter, dateEndFilter },
      { defaultView: activeTab },
    );
  }, [activeTab, locationFilter, dateStartFilter, dateEndFilter]);

  useEffect(() => {
    if (!dashboard || !queuePreferences.ready || compactQueueDefaultApplied.current) return;
    compactQueueDefaultApplied.current = true;
    if (isCompactViewport() && activeTab === "active" && (dashboard.counts.pendingOdoo || 0) > 0) {
      setActiveTab("pendingOdoo");
    }
  }, [dashboard, queuePreferences.ready]);

  const tabs = useMemo(() => buildSurveillanceTabs(dashboard?.counts, {
    clock: Clock,
    complete: CheckCircle,
    odoo: ClipboardCheck,
    missing: Tool02,
  }), [dashboard?.counts]);
  const compactTabs = useMemo(() => buildCompactSurveillanceTabs(tabs), [tabs]);
  const locations = useMemo(() => surveillanceLocations(dashboard), [dashboard]);
  const effectiveLocationFilter = locations.includes(locationFilter) ? locationFilter : "";
  const rows = useMemo(() => (dashboard?.[activeTab] || [])
    .filter((workorder) => workorderMatchesSearch(workorder, search))
    .filter((workorder) => !effectiveLocationFilter || workorder.locationName === effectiveLocationFilter)
    .filter((workorder) => matchesDateFilter(
      workorder.closedAt || workorder.updatedAt,
      dateStartFilter,
      dateEndFilter,
    )), [dashboard, activeTab, search, effectiveLocationFilter, dateStartFilter, dateEndFilter]);

  function clearFilters() {
    setSearch("");
    setLocationFilter("");
    setDateStartFilter("");
    setDateEndFilter("");
    setCustomDateOpen(false);
  }

  function applyDatePreset(preset) {
    const range = datePresetRange(preset);
    if (!range) return;
    setCustomDateOpen(false);
    setDateStartFilter(range.start);
    setDateEndFilter(range.end);
  }

  function openCustomDate() {
    setCustomDateOpen(true);
    if (!dateStartFilter && !dateEndFilter) {
      const today = dateInputValue(new Date());
      setDateStartFilter(today);
      setDateEndFilter(today);
    }
  }

  function clearDates() {
    setDateStartFilter("");
    setDateEndFilter("");
    setCustomDateOpen(false);
  }

  return {
    activeDatePreset: activeDatePreset(dateStartFilter, dateEndFilter),
    activeTab,
    applyDatePreset,
    clearDates,
    clearFilters,
    compactTabs,
    customDateOpen,
    dashboard,
    dateEndFilter,
    dateStartFilter,
    effectiveLocationFilter,
    error,
    loadDashboard,
    loading,
    locations,
    openCustomDate,
    rows,
    search,
    setActiveTab,
    setCustomDateOpen,
    setDateEndFilter,
    setDateStartFilter,
    setError,
    setLocationFilter,
    setSearch,
    tabs,
  };
}
