import { WorkorderActivityModule } from "./activity/WorkorderActivityModule.jsx";
import { WorkorderAssignmentModule } from "./assignment/WorkorderAssignmentModule.jsx";
import { WorkorderChatModule } from "./chat/WorkorderChatModule.jsx";
import { WorkorderCompletionModule } from "./completion/WorkorderCompletionModule.jsx";
import { WorkorderDiagnosisRepairModule } from "./diagnosis-repair/WorkorderDiagnosisRepairModule.jsx";
import { WorkorderLocationModule } from "./location/WorkorderLocationModule.jsx";
import { WorkorderOdooModule } from "./odoo/WorkorderOdooModule.jsx";
import { WorkorderPartsModule } from "./parts/WorkorderPartsModule.jsx";
import { WorkorderPhotosModule } from "./photos/WorkorderPhotosModule.jsx";
import { WorkorderScheduleModule } from "./schedule/WorkorderScheduleModule.jsx";
import { WorkorderUnitModule } from "./unit/WorkorderUnitModule.jsx";
import { WorkorderConcernModule } from "./work/WorkorderConcernModule.jsx";
import { moduleRenderer } from "./module-renderer-catalog.js";

export const DETAIL_MODULE_RENDERERS = Object.freeze({
  activity: WorkorderActivityModule,
  assignment: WorkorderAssignmentModule,
  chat: WorkorderChatModule,
  completion: WorkorderCompletionModule,
  concern: WorkorderConcernModule,
  diagnosisRepair: WorkorderDiagnosisRepairModule,
  location: WorkorderLocationModule,
  odoo: WorkorderOdooModule,
  parts: WorkorderPartsModule,
  photos: WorkorderPhotosModule,
  schedule: WorkorderScheduleModule,
  unit: WorkorderUnitModule,
});

export function detailModuleRenderer(moduleId, renderers = DETAIL_MODULE_RENDERERS) {
  return moduleRenderer(moduleId, renderers);
}

export function WorkorderDetailModuleHost({ moduleProps = {}, renderers = DETAIL_MODULE_RENDERERS, sections = [] }) {
  return (
    <div className="accordion-stack workorder-progressive-stack">
      {sections.map((section) => {
        if (section.modulePolicy?.descriptor?.placementBySurface?.detail === "supporting") return null;
        const Renderer = detailModuleRenderer(section.id, renderers);
        if (!Renderer) return null;
        return <Renderer key={section.id} access={section.access} {...moduleProps[section.id]} />;
      })}
    </div>
  );
}
