import { CreateAssignmentModule } from "./assignment/CreateAssignmentModule.jsx";
import { CreateLocationModule } from "./location/CreateLocationModule.jsx";
import { CreatePartsModule } from "./parts/CreatePartsModule.jsx";
import { CreateScheduleModule } from "./schedule/CreateScheduleModule.jsx";
import { CreateUnitModule } from "./unit/CreateUnitModule.jsx";
import { CreateConcernModule } from "./work/CreateConcernModule.jsx";
import { moduleRenderer } from "./module-renderer-catalog.js";

export const CREATE_MODULE_RENDERERS = Object.freeze({
  assignment: CreateAssignmentModule,
  concern: CreateConcernModule,
  location: CreateLocationModule,
  parts: CreatePartsModule,
  schedule: CreateScheduleModule,
  unit: CreateUnitModule,
});

export function createModuleRenderer(moduleId, renderers = CREATE_MODULE_RENDERERS) {
  return moduleRenderer(moduleId, renderers);
}

export function WorkorderCreateModuleHost({ moduleProps = {}, renderers = CREATE_MODULE_RENDERERS, sections = [] }) {
  return (
    <div className="accordion-stack workorder-progressive-stack create-workorder-progressive-stack">
      {sections.map((section) => {
        if (section.modulePolicy?.descriptor?.placementBySurface?.create === "supporting") return null;
        const Renderer = createModuleRenderer(section.id, renderers);
        if (!Renderer) return null;
        return <Renderer key={section.id} access={section.access} {...moduleProps[section.id]} />;
      })}
    </div>
  );
}
