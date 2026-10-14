// Reuse completion evidence before attempting a new archive generation lease.
export async function loadInspectionPrintableArchive({ inspection, canWrite, request }) {
  const base = `/api/inspections/${encodeURIComponent(inspection.id)}`;
  try {
    return await request(`${base}/print`);
  } catch (error) {
    if (!canWrite || error.code !== "INSPECTION_PRINT_ARCHIVE_UNAVAILABLE") throw error;
  }
  const result = await request(`${base}/print-archives`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: `inspection-print-${inspection.id}-v${inspection.version}` }),
  });
  return request(`${base}/print-archives/${encodeURIComponent(result.archive.id)}`);
}
