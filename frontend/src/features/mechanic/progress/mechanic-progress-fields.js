export function resolveMechanicProgressFields(workorder = {}, savedForm = {}) {
  return {
    diagnosis: workorder.diagnosis ?? savedForm.diagnosis ?? "",
    workPerformed: workorder.workPerformed ?? savedForm.workPerformed ?? "",
  };
}
