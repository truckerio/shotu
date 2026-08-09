import { validateCreateWorkorder } from "../../features/generator/create-workorder-validation.js";
import { api } from "../../lib/api.js";

export function createdWorkorderMessage({ assigned, mechanic, serial }) {
  if (mechanic) return `${serial} created and assigned to you.`;
  return assigned ? `${serial} created and assigned.` : `${serial} added to the available queue.`;
}

export function useRoleRouterCommands({
  activeWorkorder,
  actor,
  createAssignment,
  finishRoleWorkspace,
  form,
  openOfficeWorkorder,
  openOperationalWorkorder,
  openRoleWorkspace,
  returnToMyWork,
  setCreateAttempt,
  setCreateErrors,
  setCreateState,
  setDraftLeaveBusy,
  setResumedDraft,
  workorderDraft,
  workorderDraftPayload,
}) {
  async function createWorkorder(event) {
    event?.preventDefault?.();
    const errors = validateCreateWorkorder(form);
    if (Object.keys(errors).length) {
      setCreateErrors(errors);
      setCreateAttempt((attempt) => attempt + 1);
      setCreateState({ busy: false, message: "Fix the highlighted fields before creating the workorder." });
      return;
    }
    setCreateErrors({});
    setCreateAttempt(0);
    setCreateState({ busy: true, message: "Creating workorder..." });
    try {
      if (!["admin", "office"].includes(actor.role)) {
        const result = await api("/api/workorders", {
          method: "POST",
          body: JSON.stringify(workorderDraftPayload),
        });
        setCreateState({
          busy: false,
          message: createdWorkorderMessage({ mechanic: actor.role === "mechanic", serial: result.workorder.serial }),
        });
        if (actor.role === "mechanic") {
          const detail = await api(`/api/mechanic/workorders/${encodeURIComponent(result.workorder.id)}`);
          openOperationalWorkorder(detail);
        } else {
          finishRoleWorkspace();
        }
        return;
      }
      const savedDraft = await workorderDraft.flush();
      if (!savedDraft?.id || !savedDraft?.version) {
        throw new Error("The draft could not be saved. Try again before creating the workorder.");
      }
      const result = await api(`/api/workorder-drafts/${encodeURIComponent(savedDraft.id)}/submit`, {
        method: "POST",
        body: JSON.stringify({ version: savedDraft.version }),
      });
      workorderDraft.reset(null);
      setResumedDraft(null);
      setCreateState({
        busy: false,
        message: createdWorkorderMessage({
          assigned: createAssignment.mechanicUserIds.length > 0,
          serial: result.workorder.serial,
        }),
      });
      const opened = await openOfficeWorkorder(result.workorder.id);
      if (!opened) finishRoleWorkspace();
    } catch (error) {
      setCreateState({ busy: false, message: error.message });
    }
  }

  async function leaveDraft(action, { reset = false } = {}) {
    setDraftLeaveBusy(true);
    try {
      await action();
      if (reset) workorderDraft.reset(null);
      setResumedDraft(null);
      finishRoleWorkspace();
    } catch (error) {
      setCreateState({ busy: false, message: error.message });
    } finally {
      setDraftLeaveBusy(false);
    }
  }

  function returnToRoleWorkspace() {
    if (actor.role === "admin" || actor.role === "office") {
      openRoleWorkspace();
      return;
    }
    if (activeWorkorder) returnToMyWork();
    else finishRoleWorkspace();
  }

  return {
    createWorkorder,
    discardDraftAndLeave: () => leaveDraft(workorderDraft.discard),
    returnToRoleWorkspace,
    saveDraftAndLeave: () => leaveDraft(workorderDraft.flush, { reset: true }),
  };
}
