import { useMediaQuery } from "../../hooks/useMediaQuery.js";
import { SurveillanceDetailPage } from "./workspace/SurveillanceDetailPage.jsx";
import { SurveillanceQueueView } from "./workspace/SurveillanceQueueView.jsx";
import { useSurveillanceDetail } from "./workspace/useSurveillanceDetail.js";
import { useSurveillanceQueue } from "./workspace/useSurveillanceQueue.js";
import "./surveillance.css";

export function SurveillanceWorkspace({ actor }) {
  const isPhone = useMediaQuery("(max-width: 640px)");
  const queue = useSurveillanceQueue();
  const detail = useSurveillanceDetail({
    activeTab: queue.activeTab,
    loadDashboard: queue.loadDashboard,
    rows: queue.rows,
    setError: queue.setError,
  });

  if (detail.detail) {
    return (
      <SurveillanceDetailPage
        controller={detail}
        error={queue.error}
        isPhone={isPhone}
        rows={queue.rows}
      />
    );
  }

  return (
    <SurveillanceQueueView
      actor={actor}
      queue={queue}
      onOpenWorkorder={detail.openWorkorder}
    />
  );
}
