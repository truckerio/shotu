import { useMemo } from "react";

import { writeOfficeWorkorderEditBackup } from "../../features/workorder-detail/office-workorder-autosave-storage.js";
import { api } from "../../lib/api.js";
import { emptyPart } from "../../../../shared/workorder-template.js";
import { replacePartWithSerializedUnitRows } from "../../features/workorder-modules/parts/create-parts-model.js";

const MODULE_OWNED_AUTOSAVE_FIELDS = new Set(["diagnosis", "workPerformed"]);

export function normalizeSavedUsedParts(parts) {
  return parts.map((part) => ({
    partNo: part.partNo,
    qty: part.qty,
    uomCode: part.uomCode,
    repairOrder: part.repairOrder,
  }));
}

export function createRoleRouterFormController({
  activeWorkorder,
  actorId,
  form,
  isOfficeDetail,
  officeActionsRef,
  setActiveWorkorder,
  setCreateErrors,
  setForm,
  setUsedPartsDirty,
}) {
  function clearCreateErrors(...fields) {
    setCreateErrors((current) => {
      if (!fields.some((field) => current[field])) return current;
      const next = { ...current };
      fields.forEach((field) => delete next[field]);
      return next;
    });
  }

  function stageOfficeAutosave(patch) {
    const workorderId = activeWorkorder?.workorder?.id;
    if (!isOfficeDetail || !activeWorkorder?.allowedActions?.update || !workorderId) return;
    writeOfficeWorkorderEditBackup(actorId, workorderId, patch);
    officeActionsRef.current?.queueOfficeWorkorderAutosave();
  }

  function updateField(field, value) {
    clearCreateErrors(field);
    setForm((current) => ({ ...current, [field]: value }));
    if (!MODULE_OWNED_AUTOSAVE_FIELDS.has(field)) {
      stageOfficeAutosave({ [field]: value });
    }
  }

  function updateStartDate(value) {
    const workEndDate = !form.workEndDate || form.workEndDate < value ? value : form.workEndDate;
    setForm((current) => ({ ...current, workDate: value, workStartDate: value, workEndDate }));
    stageOfficeAutosave({ workDate: value, workStartDate: value, workEndDate });
  }

  function updatePart(index, field, value) {
    const patch = typeof field === "object" && field ? field : { [field]: value };
    setForm((current) => ({
      ...current,
      parts: current.parts.map((part, partIndex) => (partIndex === index ? { ...part, ...patch } : part)),
    }));
  }

  function addPartRow(part = null) {
    setForm((current) => {
      const nextPart = part ? { ...emptyPart(), ...part } : emptyPart();
      if (part) {
        const blankIndex = current.parts.findIndex((candidate) => (
          !candidate.partNo && !candidate.qty && !candidate.repairOrder
        ));
        if (blankIndex >= 0) {
          return {
            ...current,
            parts: current.parts.map((candidate, index) => index === blankIndex ? nextPart : candidate),
          };
        }
      }
      if (current.parts.length >= 18) return current;
      return { ...current, parts: [...current.parts, nextPart] };
    });
  }

  function removePartRow(index) {
    setForm((current) => ({
      ...current,
      parts: current.parts.length <= 1 ? current.parts : current.parts.filter((_, partIndex) => partIndex !== index),
    }));
  }

  function replacePartSerializedUnits(index, selection) {
    setForm((current) => ({
      ...current,
      parts: replacePartWithSerializedUnitRows(current.parts, index, selection),
    }));
  }

  function updateActiveUsedParts(parts, options = {}) {
    const saved = options.saved === true;
    setUsedPartsDirty(!saved);
    setForm((current) => ({ ...current, parts }));
    if (saved && options.workorder) {
      setActiveWorkorder((current) => current ? {
        ...current,
        workorder: options.workorder,
      } : current);
    }
  }

  function updateActiveLaborHours(laborHours) {
    setForm((current) => ({ ...current, laborHours }));
  }

  async function saveActiveUsedParts(parts) {
    const workorderId = activeWorkorder?.workorder?.id;
    if (!workorderId) throw new Error("Open a workorder before saving parts.");
    if (isOfficeDetail) {
      return officeActionsRef.current?.saveActiveUsedParts(parts);
    }

    const savedParts = normalizeSavedUsedParts(parts);
    const result = await api(`/api/mechanic/workorders/${workorderId}/used-parts`, {
      method: "PATCH",
      body: JSON.stringify({ parts: savedParts }),
    });
    return {
      parts: normalizeSavedUsedParts(result?.workorder?.formData?.parts || savedParts),
      workorder: result?.workorder,
    };
  }

  return {
    addPartRow,
    clearCreateErrors,
    removePartRow,
    replacePartSerializedUnits,
    saveActiveUsedParts,
    stageOfficeAutosave,
    updateActiveUsedParts,
    updateActiveLaborHours,
    updateField,
    updatePart,
    updateStartDate,
  };
}

export function useRoleRouterFormController(options) {
  const {
    activeWorkorder,
    actorId,
    form,
    isOfficeDetail,
    officeActionsRef,
    setActiveWorkorder,
    setCreateErrors,
    setForm,
    setUsedPartsDirty,
  } = options;

  return useMemo(() => createRoleRouterFormController({
    activeWorkorder: activeWorkorder ? {
      allowedActions: { update: activeWorkorder.allowedActions?.update },
      workorder: { id: activeWorkorder.workorder?.id },
    } : null,
    actorId,
    form: { workEndDate: form.workEndDate },
    isOfficeDetail,
    officeActionsRef,
    setActiveWorkorder,
    setCreateErrors,
    setForm,
    setUsedPartsDirty,
  }), [
    activeWorkorder?.allowedActions?.update,
    activeWorkorder?.workorder?.id,
    actorId,
    form.workEndDate,
    isOfficeDetail,
    officeActionsRef,
    setActiveWorkorder,
    setCreateErrors,
    setForm,
    setUsedPartsDirty,
  ]);
}
