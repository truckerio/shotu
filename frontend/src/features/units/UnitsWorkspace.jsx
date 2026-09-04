import { useEffect, useState } from "react";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { SecondaryDetailPanel, SecondaryDetailSection } from "../../components/ui/SecondaryDetailPanel.jsx";
import { SectionHelpDisclosure } from "../../components/workorders/SectionHelpDisclosure.jsx";
import {
  OperationalCollectionPage, OperationalCollectionToolbar, OperationalCollectionResultHeader,
  OperationalCollectionTable, OperationalCollectionRow, OperationalCollectionCell,
} from "../../components/operations/OperationalCollectionPage.jsx";
import { api } from "../../lib/api.js";
import { unitsDirectoryPath, unitsFilters, unitsFilterUrl, unitTitle } from "./units-directory-model.js";
import { UnitPartsLifecycle } from "./UnitPartsLifecycle.jsx";
import "./units-workspace.css";

const columns = [
  { id: "unit", label: "Unit" }, { id: "type", label: "Type" },
  { id: "vehicle", label: "Vehicle" }, { id: "vin", label: "VIN / plate" },
];

export function UnitsWorkspace({ presentation = "page", actorId = "" }) {
  const [filters, setFilters] = useState(() => unitsFilters(window.location.search));
  const [cursorStack, setCursorStack] = useState([""]);
  const [page, setPage] = useState({ items: [], nextCursor: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const cursor = cursorStack.at(-1);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      api(unitsDirectoryPath(filters, cursor), { signal: controller.signal })
        .then((result) => { if (active) setPage(result); })
        .catch((failure) => { if (active) { setPage({ items: [], nextCursor: null }); setError(failure.message); } })
        .finally(() => { if (active) setLoading(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [filters, cursor, retry]);

  useEffect(() => {
    function restoreFilters() {
      setFilters(unitsFilters(window.location.search));
      setCursorStack([""]);
      setSelected(null);
      setDetailBusy(false);
    }
    window.addEventListener("popstate", restoreFilters);
    return () => window.removeEventListener("popstate", restoreFilters);
  }, []);

  function changeFilters(next) {
    setFilters(next);
    setCursorStack([""]);
    setLoading(true);
    setSelected(null);
    setDetailBusy(false);
    window.history.replaceState(window.history.state, "", unitsFilterUrl(window.location.href, next));
  }

  return (
    <OperationalCollectionPage title="Units" presentation={presentation} className={`${presentation === "page" ? "admin-content " : ""}units-workspace`}>
      <OperationalCollectionToolbar className="units-toolbar">
        <label className="units-search"><span>Search</span><input type="search" maxLength={120} value={filters.q} placeholder="Unit number, VIN, or plate" onChange={(event) => changeFilters({ ...filters, q: event.target.value })} /></label>
        <label><span>Type</span><Dropdown value={filters.type} onChange={(event) => changeFilters({ ...filters, type: event.target.value })} aria-label="Unit type"><option value="">All types</option><option value="Truck">Trucks</option><option value="Trailer">Trailers</option></Dropdown></label>
        {filters.q || filters.type ? <Button type="button" onClick={() => changeFilters({ q: "", type: "" })}>Clear filters</Button> : null}
      </OperationalCollectionToolbar>
      <OperationalCollectionResultHeader><span role="status">{loading ? "Loading units…" : error ? "Units could not be loaded" : `${page.items.length} units on this page`}</span></OperationalCollectionResultHeader>
      {error ? <div className="units-feedback" role="alert"><p>{error}</p><Button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</Button></div> : null}
      {!loading && !error && !page.items.length ? <p className="units-feedback">{filters.q || filters.type ? "No matching units. Try another number or clear the filters." : "No units are available in your access scope."}</p> : null}
      {!loading && !error && page.items.length > 0 ? <OperationalCollectionTable columns={columns} ariaLabel="Trucks and trailers">
        {page.items.map((unit) => <OperationalCollectionRow key={unit.id} onAction={() => { setDetailBusy(false); setSelected(unit); }} ariaLabel={`Open ${unitTitle(unit)}`}>
          <OperationalCollectionCell label="Unit"><strong>{unit.unitNo || unit.name || "Unnumbered"}</strong></OperationalCollectionCell>
          <OperationalCollectionCell label="Type">{unit.unitType || "—"}</OperationalCollectionCell>
          <OperationalCollectionCell label="Vehicle">{[unit.year, unit.make, unit.model].filter(Boolean).join(" ") || "—"}</OperationalCollectionCell>
          <OperationalCollectionCell label="VIN / plate">{unit.vin || unit.licensePlate || "—"}</OperationalCollectionCell>
        </OperationalCollectionRow>)}
      </OperationalCollectionTable> : null}
      <nav className="units-pagination" aria-label="Units pages">
        <Button type="button" disabled={loading || cursorStack.length === 1} onClick={() => { setLoading(true); setCursorStack((stack) => stack.slice(0, -1)); }}>Previous</Button>
        <span>Page {cursorStack.length}</span>
        <Button type="button" disabled={loading || Boolean(error) || !page.nextCursor} onClick={() => { setLoading(true); setCursorStack((stack) => [...stack, page.nextCursor]); }}>Next</Button>
      </nav>
      <SecondaryDetailPanel open={Boolean(selected)} dismissable={!detailBusy} closeDisabled={detailBusy} onOpenChange={(open) => { if (!open && !detailBusy) setSelected(null); }} onClose={() => { if (!detailBusy) setSelected(null); }} title={selected ? unitTitle(selected) : "Unit details"} eyebrow="Unit">
        {selected ? <SecondaryDetailSection title="Overview"><dl className="units-overview">
          {[["Unit number", selected.unitNo], ["Type", selected.unitType], ["Name", selected.name], ["VIN", selected.vin], ["License plate", selected.licensePlate], ["Make", selected.make], ["Model", selected.model], ["Year", selected.year]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "Not recorded"}</dd></div>)}
        </dl></SecondaryDetailSection> : null}
        {selected ? <SecondaryDetailSection title="Parts custody" action={<SectionHelpDisclosure label="Parts custody help"><p>Removal records custody; it does not make stock available.</p><p>Receive the physical part, then inspect it before release.</p><p>Document company ownership before release. Unknown or customer-owned parts can be held.</p></SectionHelpDisclosure>}><UnitPartsLifecycle unit={selected} actorId={actorId} onBusyChange={setDetailBusy} /></SecondaryDetailSection> : null}
      </SecondaryDetailPanel>
    </OperationalCollectionPage>
  );
}
