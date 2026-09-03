import { useState } from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery.js";
import { PageHeader } from "../../components/layout/PageHeader.jsx";
import { WorkspaceHeader } from "../../components/layout/WorkspaceHeader.jsx";
import { InspectionExperience, ProductModeSwitch } from "../inspections/index.js";
import { SurveillanceDetailPage } from "./workspace/SurveillanceDetailPage.jsx";
import { SurveillanceQueueView } from "./workspace/SurveillanceQueueView.jsx";
import { useSurveillanceDetail } from "./workspace/useSurveillanceDetail.js";
import { useSurveillanceQueue } from "./workspace/useSurveillanceQueue.js";
import "./surveillance.css";

export function SurveillanceWorkspace({ actor, inspectionAccess = { canRead: false }, workorderAccess = { canRead: true } }) {
  const isPhone = useMediaQuery("(max-width: 640px)");
  const [product, setProduct] = useState(() => !workorderAccess.canRead && inspectionAccess.canRead ? "inspections" : "workorders");
  const queue = useSurveillanceQueue();
  const detail = useSurveillanceDetail({
    activeTab: queue.activeTab,
    loadDashboard: queue.loadDashboard,
    rows: queue.rows,
    setError: queue.setError,
  });

  if (product === "inspections" && inspectionAccess.canRead) {
    return (
      <main className="prototype mechanic-home workspace-operations">
        <WorkspaceHeader actor={actor} className="role-home-account-header" locale="en" />
        <div className="mechanic-home-content">
          <PageHeader title="Inspections" />
          {workorderAccess.canRead ? <ProductModeSwitch value={product} onChange={setProduct} /> : null}
          <InspectionExperience actor={actor} projection="read_only" />
        </div>
      </main>
    );
  }

  if (detail.detail) {
    return (
      <SurveillanceDetailPage
        actor={actor}
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
      inspectionAccess={inspectionAccess}
      product={product}
      onProductChange={setProduct}
      workorderAccess={workorderAccess}
    />
  );
}
