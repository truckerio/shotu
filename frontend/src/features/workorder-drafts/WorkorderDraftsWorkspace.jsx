import { useMemo, useState } from "react";
import { ArrowRight, Clock, Edit05, File02, SearchMd, Trash01, Users01 } from "@untitledui/icons";
import { Button } from "../../components/ui/Button.jsx";
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
      <span>{draft.serial || draft.id?.slice(0, 8) || "Draft"}</span>
      {concern ? <p title={concern}>{concern}</p> : <p className="is-muted">No concern entered</p>}
    </div>
  );
}

function DraftPeople({ draft }) {
  const creator = draftCreator(draft);
  const owner = draftOwner(draft);
  return (
    <div className="workorder-draft-people">
      <span>{creator || "You"}</span>
      {owner && owner !== creator ? <small>Edited by {owner}</small> : null}
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
      {canTakeover ? <Button type="button" icon={Users01} disabled={busy} onClick={() => onTakeover(draft)}>{busy ? "Taking over" : "Take over"}</Button> : null}
      {canOpen ? <Button type="button" variant="primary" icon={ArrowRight} disabled={busy} onClick={() => onOpen(draft)}>{busy ? "Opening" : "Resume"}</Button> : null}
      {canDiscard ? (
        <button className="workorder-draft-icon-action is-danger" type="button" disabled={busy} title="Discard draft" aria-label={`Discard ${draftUnit(draft)} draft`} onClick={() => onDiscard(draft)}>
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
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (canOpen && !busy) onOpen(draft);
  }
  return (
    <article className={`workorder-draft-row${canOpen ? " is-interactive" : ""}`} tabIndex={canOpen ? "0" : undefined} onClick={activate} onKeyDown={keyDown} aria-label={`${canOpen ? "Open" : "View"} draft for ${draftUnit(draft)}`}>
      <div className="workorder-draft-cell workorder-draft-main" data-label="Unit / workorder"><DraftIdentity draft={draft} /></div>
      <div className="workorder-draft-cell" data-label="Location"><span className="workorder-draft-location">{draftLocation(draft)}</span></div>
      <div className="workorder-draft-cell" data-label="Created by"><DraftPeople draft={draft} /></div>
      <div className="workorder-draft-cell" data-label="Last saved" title={formatDraftUpdatedTitle(updatedAt)}><span className="workorder-draft-saved"><Clock aria-hidden="true" />{formatDraftUpdatedAt(updatedAt)}</span></div>
      <div className="workorder-draft-cell" data-label="Completeness"><MissingFields draft={draft} /></div>
      <div className="workorder-draft-cell workorder-draft-row-actions" data-label="Actions"><DraftActions draft={draft} role={role} actorId={actorId} canOpen={canOpen} busy={busy} onOpen={onOpen} onDiscard={onDiscard} onTakeover={onTakeover} /></div>
    </article>
  );
}

function EmptyState({ filtered, onNew }) {
  return (
    <div className="workorder-drafts-state" role="status">
      <File02 aria-hidden="true" />
      <strong>{filtered ? "No drafts match this search" : "No saved drafts"}</strong>
      <span>{filtered ? "Try a different unit, location, or concern." : "Start a workorder and it will appear here as you work."}</span>
      {!filtered && typeof onNew === "function" ? <Button type="button" variant="primary" icon={Edit05} onClick={onNew}>New workorder</Button> : null}
    </div>
  );
}

export function WorkorderDraftsWorkspace({
  role,
  actorId = "",
  drafts = [],
  loading = false,
  error = "",
  busyId = "",
  onNew,
  onOpen,
  onDiscard,
  onTakeover,
  onRefresh,
  canOpen: canOpenOverride,
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("my");
  const [discardDraft, setDiscardDraft] = useState(null);
  const [discardBusy, setDiscardBusy] = useState(false);
  const [discardError, setDiscardError] = useState("");

  function requestDiscard(draft) {
    setDiscardError("");
    setDiscardDraft(draft);
  }

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

  const visibleDrafts = useMemo(() => drafts.filter((draft) => {
    if (!draftMatchesSearch(draft, search)) return false;
    const belongsToActor = draftBelongsToActor(draft, actorId);
    if (filter === "my" && !belongsToActor) return false;
    if (filter === "team" && belongsToActor) return false;
    if (filter === "needs_details" && draftMissingFields(draft).length === 0) return false;
    return true;
  }), [actorId, drafts, filter, search]);

  if (!["office", "admin"].includes(role)) return null;

  return (
    <section className="workorder-drafts-workspace" aria-labelledby="workorder-drafts-title">
      <header className="workorder-drafts-header">
        <div className="workorder-drafts-heading">
          <div className="workorder-drafts-title-line"><File02 aria-hidden="true" /><h1 id="workorder-drafts-title">Drafts</h1><span className="workorder-drafts-count">{drafts.length}</span></div>
          <p>Unsubmitted workorders saved for later.</p>
        </div>
        <div className="workorder-drafts-header-actions">
          {typeof onNew === "function" ? <Button type="button" variant="primary" icon={Edit05} onClick={onNew}>New workorder</Button> : null}
        </div>
      </header>

      <div className="workorder-drafts-toolbar">
        <label className="workorder-drafts-search">
          <span className="workorder-drafts-visually-hidden">Search drafts</span>
          <SearchMd aria-hidden="true" />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search unit, concern, location" />
        </label>
        <label className="workorder-drafts-filter">
          <span className="workorder-drafts-visually-hidden">Filter drafts</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="my">My drafts</option>
            <option value="team">Team drafts</option>
            <option value="needs_details">Needs details</option>
          </select>
        </label>
      </div>

      {error ? <div className="workorder-drafts-error" role="alert"><strong>Could not load drafts.</strong><span>{error}</span>{typeof onRefresh === "function" ? <Button type="button" onClick={onRefresh}>Try again</Button> : null}</div> : null}
      {loading ? <div className="workorder-drafts-loading" role="status" aria-label="Loading drafts">{[1, 2, 3].map((item) => <span key={item} />)}</div> : null}
      {!loading && !error && !visibleDrafts.length ? <EmptyState filtered={Boolean(search || filter !== "my")} onNew={onNew} /> : null}
      {!loading && !error && visibleDrafts.length ? (
        <div className="workorder-drafts-table" role="table" aria-label="Saved workorder drafts">
          <div className="workorder-drafts-table-head" role="row">
            <span>Unit / workorder</span><span>Location</span><span>Created by</span><span>Last saved</span><span>Completeness</span><span>Actions</span>
          </div>
          <div role="rowgroup">{visibleDrafts.map((draft) => {
            const canOpen = typeof canOpenOverride === "function" ? Boolean(canOpenOverride(draft)) : draftBelongsToActor(draft, actorId);
            return <DraftRow key={draft.id} draft={draft} role={role} actorId={actorId} canOpen={canOpen} busy={busyId === draft.id} onOpen={onOpen} onDiscard={requestDiscard} onTakeover={onTakeover} />;
          })}</div>
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
