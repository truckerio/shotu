import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { useMemo, useState } from "react";
import { ArrowRight, Clock, File02, SearchMd, Trash01, Users01 } from "@untitledui/icons";
import { Button } from "../../components/ui/Button.jsx";
import { textEntryProps } from "../../components/forms/text-entry-policy.js";
import { DraftDiscardDialog } from "./DraftDiscardDialog.jsx";
import {
  draftConcern,
  draftBelongsToActor,
  draftCreator,
  draftLocation,
  draftMatchesSearch,
  draftMissingFields,
  draftOwner,
  draftOwnerId,
  draftUnit,
  formatDraftUpdatedAt,
  formatDraftUpdatedTitle,
} from "./workorder-draft-format.js";
import "./workorder-drafts.css";

function DraftIdentity({ draft }) {
  const concern = draftConcern(draft);
  return (
    <div className="workorder-draft-identity">
      <strong>{draftUnit(draft)}</strong>
      <span>Draft</span>
      {concern ? <p title={concern}>{concern}</p> : <p className="is-muted">No concern entered</p>}
    </div>
  );
}

function DraftPeople({ draft }) {
  const creator = draftCreator(draft);
  const owner = draftOwner(draft);
  return (
    <div className="workorder-draft-people">
      <span>{owner || creator || "Unassigned"}</span>
      {creator && owner && owner !== creator ? <small>Created by {creator}</small> : null}
    </div>
  );
}

function MissingFields({ draft }) {
  const missing = draftMissingFields(draft);
  return missing.length ? (
    <span className="workorder-draft-missing" title={`Missing: ${missing.join(", ")}`}>
      Missing {missing.slice(0, 2).join(", ")}{missing.length > 2 ? ` +${missing.length - 2}` : ""}
    </span>
  ) : <span className="workorder-draft-ready">Ready to continue</span>;
}

function DraftActions({ draft, role, actorId, canOpen, busy, onOpen, onDiscard, onTakeover }) {
  const ownerId = draftOwnerId(draft);
  const canTakeover = role === "admin"
    && typeof onTakeover === "function"
    && Boolean(ownerId)
    && ownerId !== String(actorId || "")
    && !canOpen;
  const canDiscard = typeof onDiscard === "function" && (canOpen || role === "admin");

  return (
    <div className="workorder-draft-actions" onClick={(event) => event.stopPropagation()}>
      {canTakeover ? (
        <Button type="button" icon={Users01} disabled={busy} onClick={() => onTakeover(draft)}>
          {busy ? "Taking over" : "Take over"}
        </Button>
      ) : null}
      {canOpen ? (
        <Button type="button" variant="primary" icon={ArrowRight} disabled={busy} onClick={() => onOpen(draft)}>
          {busy ? "Opening" : "Resume"}
        </Button>
      ) : null}
      {canDiscard ? (
        <button
          className="workorder-draft-icon-action is-danger"
          type="button"
          disabled={busy}
          title="Discard draft"
          aria-label={`Discard ${draftUnit(draft)} draft`}
          onClick={() => onDiscard(draft)}
        >
          <Trash01 aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function DraftRow({ draft, role, actorId, canOpen, busy, onOpen, onDiscard, onTakeover }) {
  const updatedAt = draft.updatedAt || draft.updated_at;

  function activate(event) {
    if (event.target.closest("button")) return;
    if (canOpen && !busy) onOpen(draft);
  }

  function keyDown(event) {
    if (!["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    if (canOpen && !busy) onOpen(draft);
  }

  return (
    <article
      className={`workorder-draft-row${canOpen ? " is-interactive" : ""}`}
      tabIndex={canOpen ? 0 : undefined}
      onClick={activate}
      onKeyDown={keyDown}
      aria-label={`${canOpen ? "Open" : "View"} draft for ${draftUnit(draft)}`}
    >
      <div className="workorder-draft-cell workorder-draft-main" data-label="Unit / draft"><DraftIdentity draft={draft} /></div>
      <div className="workorder-draft-cell" data-label="Location"><span className="workorder-draft-location">{draftLocation(draft)}</span></div>
      <div className="workorder-draft-cell" data-label="Owner"><DraftPeople draft={draft} /></div>
      <div className="workorder-draft-cell" data-label="Last saved" title={formatDraftUpdatedTitle(updatedAt)}>
        <span className="workorder-draft-saved"><Clock aria-hidden="true" />{formatDraftUpdatedAt(updatedAt)}</span>
      </div>
      <div className="workorder-draft-cell" data-label="Completeness"><MissingFields draft={draft} /></div>
      <div className="workorder-draft-cell workorder-draft-row-actions" data-label="Actions">
        <DraftActions
          draft={draft}
          role={role}
          actorId={actorId}
          canOpen={canOpen}
          busy={busy}
          onOpen={onOpen}
          onDiscard={onDiscard}
          onTakeover={onTakeover}
        />
      </div>
    </article>
  );
}

function EmptyState({ filtered }) {
  return (
    <div className="workorder-drafts-state" role="status">
      <File02 aria-hidden="true" />
      <strong>{filtered ? "No drafts match these filters" : "No saved drafts"}</strong>
      <span>{filtered ? "Try another unit, location, owner, or concern." : "Unsubmitted workorders will appear in this queue automatically."}</span>
    </div>
  );
}

export function WorkorderDraftQueue({
  role,
  actorId = "",
  drafts = [],
  loading = false,
  error = "",
  busyId = "",
  fixedLocationId = "",
  onOpen,
  onDiscard,
  onTakeover,
  onRefresh,
  canOpen: canOpenOverride,
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [locationId, setLocationId] = useState("");
  const [discardDraft, setDiscardDraft] = useState(null);
  const [discardBusy, setDiscardBusy] = useState(false);
  const [discardError, setDiscardError] = useState("");

  const draftLocations = useMemo(() => {
    const locations = new Map();
    for (const draft of drafts) {
      if (!draft.locationId || locations.has(draft.locationId)) continue;
      locations.set(draft.locationId, draftLocation(draft));
    }
    return [...locations.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [drafts]);
  const activeLocationId = fixedLocationId || locationId;
  const visibleDrafts = useMemo(() => drafts.filter((draft) => {
    if (activeLocationId && draft.locationId !== activeLocationId) return false;
    if (!draftMatchesSearch(draft, search)) return false;
    const belongsToActor = draftBelongsToActor(draft, actorId);
    if (filter === "my" && !belongsToActor) return false;
    if (filter === "team" && belongsToActor) return false;
    if (filter === "needs_details" && draftMissingFields(draft).length === 0) return false;
    return true;
  }), [activeLocationId, actorId, drafts, filter, search]);

  async function confirmDiscard() {
    if (!discardDraft || typeof onDiscard !== "function") return;
    setDiscardBusy(true);
    setDiscardError("");
    try {
      await onDiscard(discardDraft);
      setDiscardDraft(null);
    } catch (discardFailure) {
      setDiscardError(discardFailure?.message || "The draft could not be discarded. Try again.");
    } finally {
      setDiscardBusy(false);
    }
  }

  if (!["office", "admin"].includes(role)) return null;

  return (
    <section className="workorder-drafts-queue" aria-label="Saved workorder drafts">
      <div className="workorder-drafts-toolbar">
        <label className="workorder-drafts-search">
          <span className="workorder-drafts-visually-hidden">Search drafts</span>
          <SearchMd aria-hidden="true" />
          <input {...textEntryProps("search")} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search unit, concern, location, or owner" />
        </label>
        <label className="workorder-drafts-filter">
          <span className="workorder-drafts-visually-hidden">Filter drafts</span>
          <Dropdown value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="all">All drafts</option>
            <option value="my">My drafts</option>
            <option value="team">Team drafts</option>
            <option value="needs_details">Needs details</option>
          </Dropdown>
        </label>
        {!fixedLocationId && draftLocations.length > 1 ? (
          <label className="workorder-drafts-filter">
            <span className="workorder-drafts-visually-hidden">Filter drafts by location</span>
            <Dropdown value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              <option value="">All locations</option>
              {draftLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </Dropdown>
          </label>
        ) : null}
      </div>

      {error ? (
        <div className="workorder-drafts-error" role="alert">
          <strong>Drafts could not be loaded.</strong>
          <span>{error}</span>
          {typeof onRefresh === "function" ? <Button type="button" onClick={onRefresh}>Try again</Button> : null}
        </div>
      ) : null}
      {loading ? <div className="workorder-drafts-loading" role="status" aria-label="Loading drafts">{[1, 2, 3].map((item) => <span key={item} />)}</div> : null}
      {!loading && !error && !visibleDrafts.length ? <EmptyState filtered={Boolean(search || filter !== "all" || activeLocationId)} /> : null}
      {!loading && !error && visibleDrafts.length ? (
        <div className="workorder-drafts-table" role="table" aria-label="Saved workorder drafts">
          <div className="workorder-drafts-table-head" role="row">
            <span>Unit / draft</span><span>Location</span><span>Owner</span><span>Last saved</span><span>Completeness</span><span>Actions</span>
          </div>
          <div role="rowgroup">
            {visibleDrafts.map((draft) => {
              const canOpen = typeof canOpenOverride === "function"
                ? Boolean(canOpenOverride(draft))
                : draftBelongsToActor(draft, actorId);
              return (
                <DraftRow
                  key={draft.id}
                  draft={draft}
                  role={role}
                  actorId={actorId}
                  canOpen={canOpen}
                  busy={busyId === draft.id}
                  onOpen={onOpen}
                  onDiscard={setDiscardDraft}
                  onTakeover={onTakeover}
                />
              );
            })}
          </div>
        </div>
      ) : null}

      <DraftDiscardDialog
        open={Boolean(discardDraft)}
        draftLabel={discardDraft ? `${draftUnit(discardDraft)} draft` : "this draft"}
        busy={discardBusy}
        error={discardError}
        onCancel={() => {
          if (!discardBusy) setDiscardDraft(null);
        }}
        onDiscard={confirmDiscard}
      />
    </section>
  );
}
