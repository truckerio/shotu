import { Fragment, useEffect, useState } from "react";
import {
  PROGRESSIVE_QUEUE_PAGE_SIZE,
  progressiveQueueState,
} from "./ProgressiveQueue.js";
import "./ProgressiveQueue.css";

const PHONE_QUEUE_QUERY = "(max-width: 700px)";

function phoneQueueMatches() {
  return typeof window !== "undefined" && window.matchMedia(PHONE_QUEUE_QUERY).matches;
}

function usePhoneQueue() {
  const [compact, setCompact] = useState(phoneQueueMatches);

  useEffect(() => {
    const query = window.matchMedia(PHONE_QUEUE_QUERY);
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return compact;
}

export function ProgressiveQueue({
  items,
  resetKey,
  renderItem,
  pageSize = PROGRESSIVE_QUEUE_PAGE_SIZE,
}) {
  const compact = usePhoneQueue();
  const [progress, setProgress] = useState({ resetKey, visibleCount: pageSize });
  const visibleCount = progress.resetKey === resetKey ? progress.visibleCount : pageSize;
  const state = progressiveQueueState(items.length, visibleCount, compact, pageSize);

  function showMore() {
    setProgress({
      resetKey,
      visibleCount: state.visibleCount + pageSize,
    });
  }

  return (
    <>
      {items.slice(0, state.visibleCount).map((item, index) => (
        <Fragment key={item.id}>{renderItem(item, index)}</Fragment>
      ))}
      {state.remainingCount > 0 ? (
        <div className="progressive-queue-more">
          <button type="button" onClick={showMore}>
            Show {state.nextCount} more
            <span>({state.remainingCount} remaining)</span>
          </button>
        </div>
      ) : null}
    </>
  );
}
