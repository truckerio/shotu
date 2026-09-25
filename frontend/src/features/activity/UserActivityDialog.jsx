import { useEffect, useMemo, useState } from "react";
import { Heading } from "react-aria-components";
import { RefreshCw01, XClose } from "@untitledui/icons";
import { WorkorderTimelineList } from "../../components/workorders/WorkorderTimeline.jsx";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { IconButton } from "../../components/ui/IconButton.jsx";
import { ModalFrame } from "../../components/ui/ModalFrame.jsx";
import { api } from "../../lib/api.js";
import { beginUserActivityLoad, USER_ACTIVITY_CATEGORIES, userActivityTimelineItem } from "./user-activity-model.js";
import "./user-activity.css";

export function UserActivityDialog({ isOpen, locale = "en", onOpenChange }) {
  const [category, setCategory] = useState("");
  const [state, setState] = useState({ items: [], page: 1, total: 0, hasMore: false, loading: true, loadingMore: false, error: "" });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!isOpen) return undefined;
    let active = true;
    setState(beginUserActivityLoad);
    const query = new URLSearchParams({ page: "1", pageSize: "50" });
    if (category) query.set("category", category);
    api(`/api/activity?${query}`)
      .then((result) => { if (active) setState({ ...result, loading: false, loadingMore: false, error: "" }); })
      .catch((error) => { if (active) setState((current) => ({ ...current, items: [], total: 0, hasMore: false, loading: false, error: error.message || "Activity could not be loaded." })); });
    return () => { active = false; };
  }, [category, isOpen, reload]);

  async function loadMore() {
    if (state.loadingMore || !state.hasMore) return;
    setState((current) => ({ ...current, loadingMore: true, error: "" }));
    const query = new URLSearchParams({ page: String(state.page + 1), pageSize: String(state.pageSize || 50) });
    if (category) query.set("category", category);
    try {
      const result = await api(`/api/activity?${query}`);
      setState((current) => ({ ...result, items: [...current.items, ...result.items], loading: false, loadingMore: false, error: "" }));
    } catch (error) {
      setState((current) => ({ ...current, loadingMore: false, error: error.message || "More activity could not be loaded." }));
    }
  }

  const timelineItems = useMemo(() => state.items.map((item) => userActivityTimelineItem(item, locale)), [locale, state.items]);
  return <ModalFrame
    ariaLabelledBy="user-activity-dialog-title"
    dialogClassName="user-activity-dialog"
    isDismissable
    isOpen={isOpen}
    modalClassName="user-activity-modal"
    onOpenChange={onOpenChange}
    overlayClassName="user-activity-overlay"
  >
    <header className="user-activity-dialog-header">
      <div className="user-activity-title-row">
        <Heading id="user-activity-dialog-title" slot="title">Activity</Heading>
        <IconButton className="user-activity-close-button" icon={XClose} label="Close activity" onClick={() => onOpenChange(false)} />
      </div>
      <div className="user-activity-toolbar">
        <label><span>Show</span><Dropdown value={category} onChange={(event) => setCategory(event.target.value)}>{USER_ACTIVITY_CATEGORIES.map((option) => <option value={option.value} key={option.value || "all"}>{option.label}</option>)}</Dropdown></label>
        <div className="user-activity-toolbar-actions">
          <span className="user-activity-total" aria-live="polite">{state.loading ? (state.items.length ? "Updating…" : "Loading…") : `${state.total} ${state.total === 1 ? "event" : "events"}`}</span>
          <Button type="button" icon={RefreshCw01} onClick={() => setReload((value) => value + 1)} disabled={state.loading}>Refresh</Button>
        </div>
      </div>
    </header>
    <div className="user-activity-dialog-body">
      {state.error ? <div className="user-activity-error" role="alert"><span>{state.error}</span><Button type="button" onClick={() => setReload((value) => value + 1)}>Try again</Button></div> : null}
      {state.loading && !state.items.length ? <p className="user-activity-state" role="status">Loading activity…</p> : <div className={`user-activity-results${state.loading ? " is-updating" : ""}`} aria-busy={state.loading}><div aria-hidden={state.loading ? "true" : undefined}><WorkorderTimelineList className="user-activity-timeline" items={timelineItems} emptyMessage="No recorded activity in this category." locale={locale} /></div></div>}
      {!state.loading && state.hasMore ? <div className="user-activity-more"><Button type="button" onClick={loadMore} disabled={state.loadingMore}>{state.loadingMore ? "Loading…" : "Load more"}</Button></div> : null}
    </div>
  </ModalFrame>;
}
