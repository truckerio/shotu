import { useCallback, useEffect, useMemo, useState } from "react";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { useCheckpointPages } from "../../components/operations/useCheckpointPages.js";
import { readCheckpointPosition, saveCheckpointPosition } from "../../components/operations/checkpoint-position.js";
import { Button } from "../../components/ui/Button.jsx";
import { CheckpointCollection } from "../../components/ui/CheckpointCollection.jsx";
import { SecondaryDetailPanel, SecondaryDetailSection } from "../../components/ui/SecondaryDetailPanel.jsx";
import { SectionHelpDisclosure } from "../../components/workorders/SectionHelpDisclosure.jsx";
import {
  OperationalCollectionPage, OperationalCollectionToolbar, OperationalCollectionResultHeader,
  OperationalCollectionTable, OperationalCollectionRow, OperationalCollectionCell,
} from "../../components/operations/OperationalCollectionPage.jsx";
import { api } from "../../lib/api.js";
import { unitsDirectoryFiltersPath, unitsDirectoryPath, unitsDirectorySection, unitsFilters, unitsFilterUrl, unitTitle } from "./units-directory-model.js";
import { UnitPartsLifecycle } from "./UnitPartsLifecycle.jsx";
import "./units-workspace.css";

const columns = [
  { id: "unit", label: "Unit" }, { id: "type", label: "Type" },
  { id: "vehicle", label: "Vehicle" }, { id: "tags", label: "Tags" },
  { id: "vin", label: "VIN / plate" },
];
const PAGE_SIZE = 25;
const EMPTY_FACETS = Object.freeze({ companyTags: [], routeTags: [] });

function unitsStorageKey(section, filters, actorId) {
  return `units:${JSON.stringify([actorId, section, filters.q.trim(), filters.type, filters.companyTag, filters.routeTag, filters.repair, filters.sort])}`;
}

function optionRows(options, selected) {
  const rows = Array.isArray(options) ? options : [];
  if (!selected || rows.some((option) => option.name === selected)) return rows;
  return [{ name: selected, count: null }, ...rows];
}

function unitTagNames(unit) {
  return Array.isArray(unit.tagNames) ? unit.tagNames.filter((tag) => typeof tag === "string" && tag.trim()) : [];
}

function waitForUnitsQuery(signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("The units request was aborted.", "AbortError"));
      return;
    }
    const timer = window.setTimeout(resolve, 200);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("The units request was aborted.", "AbortError"));
    }, { once: true });
  });
}

export function UnitsWorkspace({ presentation = "page", actorId = "", section = "all" }) {
  const directorySection = unitsDirectorySection(section);
  const categoryLocked = directorySection.key !== "all";
  const [filters, setFilters] = useState(() => ({ ...unitsFilters(window.location.search), ...(categoryLocked ? { type: directorySection.type } : {}) }));
  const [selected, setSelected] = useState(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailMode, setDetailMode] = useState("");
  const [facets, setFacets] = useState(EMPTY_FACETS);
  const storageKey = unitsStorageKey(directorySection.key, filters, actorId);
  const initialPage = useMemo(() => readCheckpointPosition(storageKey)?.page || 1, [storageKey]);
  const queryKey = useMemo(() => JSON.stringify([actorId, directorySection.key, filters.q.trim(), filters.type, filters.companyTag, filters.routeTag, filters.repair, filters.sort]), [actorId, directorySection.key, filters]);
  const fetchPage = useCallback(async (nextPage, { signal }) => {
    await waitForUnitsQuery(signal);
    return api(unitsDirectoryPath({ ...filters, page: nextPage }), { signal });
  }, [filters]);
  const queue = useCheckpointPages({
    queryKey,
    fetchPage,
    initialPage,
    getItemKey: (unit) => unit.id,
  });
  const hasItems = queue.pages.some((batch) => batch.items.length);

  useEffect(() => {
    const controller = new AbortController();
    setFacets(EMPTY_FACETS);
    api(unitsDirectoryFiltersPath(filters.type), { signal: controller.signal })
      .then((result) => setFacets({
        companyTags: Array.isArray(result?.companyTags) ? result.companyTags : [],
        routeTags: Array.isArray(result?.routeTags) ? result.routeTags : [],
      }))
      .catch((error) => { if (error?.name !== "AbortError") setFacets(EMPTY_FACETS); });
    return () => controller.abort();
  }, [filters.type]);

  useEffect(() => {
    function restoreFilters() {
      const restored = { ...unitsFilters(window.location.search), ...(categoryLocked ? { type: directorySection.type } : {}) };
      saveCheckpointPosition(unitsStorageKey(directorySection.key, restored, actorId), { page: 1 });
      setFilters(restored);
      setSelected(null);
      setDetailBusy(false);
      setDetailMode("");
    }
    window.addEventListener("popstate", restoreFilters);
    return () => window.removeEventListener("popstate", restoreFilters);
  }, [actorId, categoryLocked, directorySection.key, directorySection.type]);

  function changeFilters(next) {
    const scoped = { ...next, ...(categoryLocked ? { type: directorySection.type } : {}) };
    saveCheckpointPosition(unitsStorageKey(directorySection.key, scoped, actorId), { page: 1 });
    setFilters(scoped);
    setSelected(null);
    setDetailBusy(false);
    setDetailMode("");
    window.history.replaceState(window.history.state, "", unitsFilterUrl(window.location.href, scoped));
  }

  const hasFilters = Boolean(filters.q || filters.companyTag || filters.routeTag || filters.repair !== "all" || filters.sort !== "unit_asc" || (!categoryLocked && filters.type));

  function clearFilters() {
    changeFilters({
      q: "",
      type: categoryLocked ? directorySection.type : "",
      companyTag: "",
      routeTag: "",
      repair: "all",
      sort: "unit_asc",
    });
  }

  return (
    <OperationalCollectionPage title={presentation === "page" ? directorySection.label : ""} presentation={presentation} surface className={`${presentation === "page" ? "admin-content " : ""}units-workspace`}>
      <OperationalCollectionToolbar className="units-toolbar">
        <label className="units-search"><span>{categoryLocked ? `Search ${directorySection.label.toLowerCase()}` : "Search"}</span><input type="search" maxLength={120} value={filters.q} placeholder={`${directorySection.singular} number, VIN, or plate`} onChange={(event) => changeFilters({ ...filters, q: event.target.value })} /></label>
        {!categoryLocked ? <label><span>Type</span><Dropdown value={filters.type} onChange={(event) => changeFilters({ ...filters, type: event.target.value })} aria-label="Unit type"><option value="">All types</option><option value="Truck">Trucks</option><option value="Trailer">Trailers</option><option value="Other">Other equipment</option></Dropdown></label> : null}
        <label><span>Company</span><Dropdown value={filters.companyTag} onChange={(event) => changeFilters({ ...filters, companyTag: event.target.value })} aria-label="Company"><option value="">All companies</option>{optionRows(facets.companyTags, filters.companyTag).map((option) => <option value={option.name} key={option.name}>{option.name}{option.count === null ? "" : ` (${option.count})`}</option>)}</Dropdown></label>
        <label><span>Route tag</span><Dropdown value={filters.routeTag} onChange={(event) => changeFilters({ ...filters, routeTag: event.target.value })} aria-label="Route tag"><option value="">All routes</option>{optionRows(facets.routeTags, filters.routeTag).map((option) => <option value={option.name} key={option.name}>{option.name}{option.count === null ? "" : ` (${option.count})`}</option>)}</Dropdown></label>
        <label><span>Repair state</span><Dropdown value={filters.repair} onChange={(event) => changeFilters({ ...filters, repair: event.target.value })} aria-label="Repair state"><option value="all">All repair states</option><option value="under_repair">Under repair</option><option value="available">No open workorder</option></Dropdown></label>
        <label><span>Sort</span><Dropdown value={filters.sort} onChange={(event) => changeFilters({ ...filters, sort: event.target.value })} aria-label="Sort units"><option value="unit_asc">Unit A–Z</option><option value="unit_desc">Unit Z–A</option><option value="tags_asc">Tags A–Z</option><option value="repair_first">Under repair first</option></Dropdown></label>
        {hasFilters ? <Button type="button" onClick={clearFilters}>Clear filters</Button> : null}
      </OperationalCollectionToolbar>
      <OperationalCollectionResultHeader><span role="status">{queue.loading && !queue.pages.length ? `Loading ${directorySection.label.toLowerCase()}…` : queue.error ? `${directorySection.label} could not be loaded` : `${queue.total} ${directorySection.label.toLowerCase()}`}</span></OperationalCollectionResultHeader>
      <CheckpointCollection
        ariaLabel={directorySection.label}
        getItemKey={(unit) => unit.id}
        label={directorySection.label.toLowerCase()}
        pageSize={PAGE_SIZE}
        queue={queue}
        storageKey={storageKey}
        renderItems={(entries) => hasItems ? <OperationalCollectionTable columns={columns} ariaLabel={directorySection.label} busy={queue.loading || queue.loadingMore}>
          {entries.map(({ item: unit, key, rowProps }) => {
            const tags = unitTagNames(unit);
            const repairLabel = unit.activeWorkorder?.serial ? `Under repair · ${unit.activeWorkorder.serial}` : "Under repair";
            return <OperationalCollectionRow {...rowProps} className={unit.activeWorkorder ? "units-row is-under-repair" : "units-row"} key={key} onAction={() => { setDetailBusy(false); setDetailMode(""); setSelected(unit); }} ariaLabel={`Open ${unitTitle(unit)}${unit.activeWorkorder ? ", under repair" : ""}`}>
            <OperationalCollectionCell label="Unit"><span className="units-unit-identity"><strong>{unit.unitNo || unit.name || "Unnumbered"}</strong>{unit.activeWorkorder ? <span className="units-repair-badge">{repairLabel}</span> : null}</span></OperationalCollectionCell>
            <OperationalCollectionCell label="Type">{unit.unitType || "—"}</OperationalCollectionCell>
            <OperationalCollectionCell label="Vehicle">{[unit.year, unit.make, unit.model].filter(Boolean).join(" ") || "—"}</OperationalCollectionCell>
            <OperationalCollectionCell label="Tags"><span className="units-tags" title={tags.join(", ")}>{tags.length ? <>{tags.slice(0, 3).map((tag) => <span className="units-tag" key={tag}>{tag}</span>)}{tags.length > 3 ? <span className="units-tag units-tag-more">+{tags.length - 3}</span> : null}</> : "—"}</span></OperationalCollectionCell>
            <OperationalCollectionCell label="VIN / plate">{unit.vin || unit.licensePlate || "—"}</OperationalCollectionCell>
          </OperationalCollectionRow>})}
        </OperationalCollectionTable> : null}
      >
        <p className="units-feedback">{hasFilters ? `No matching ${directorySection.label.toLowerCase()}. Try another filter or clear the filters.` : `No ${directorySection.label.toLowerCase()} are available in your access scope.`}</p>
      </CheckpointCollection>
      <SecondaryDetailPanel open={Boolean(selected)} dismissable={!detailBusy} closeDisabled={detailBusy} onOpenChange={(open) => { if (!open && !detailBusy) { setSelected(null); setDetailMode(""); } }} onClose={() => { if (!detailBusy) { setSelected(null); setDetailMode(""); } }} title={selected ? unitTitle(selected) : "Unit details"} eyebrow="Unit">
        {selected && !detailMode ? <SecondaryDetailSection title="Overview"><dl className="units-overview">
          {[["Unit number", selected.unitNo], ["Type", selected.unitType], ["Name", selected.name], ["VIN", selected.vin], ["License plate", selected.licensePlate], ["Make", selected.make], ["Model", selected.model], ["Year", selected.year], ["Samsara tags", unitTagNames(selected).join(", ")], ["Repair state", selected.activeWorkorder ? `Under repair${selected.activeWorkorder.serial ? ` · ${selected.activeWorkorder.serial}` : ""}` : "No open workorder"]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "Not recorded"}</dd></div>)}
        </dl></SecondaryDetailSection> : null}
        {selected ? <SecondaryDetailSection className={detailMode ? "unit-parts-focused-section" : ""} title="Installed parts" action={!detailMode ? <SectionHelpDisclosure label="Installed parts help"><p>Remove a tracked part here. Return it through Inventory when it reaches the shop.</p></SectionHelpDisclosure> : null}><UnitPartsLifecycle unit={selected} actorId={actorId} onBusyChange={setDetailBusy} onModeChange={setDetailMode} /></SecondaryDetailSection> : null}
      </SecondaryDetailPanel>
    </OperationalCollectionPage>
  );
}
