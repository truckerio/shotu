export function statusLabel(status) {
  const labels = {
    open: "Open",
    accepted: "Accepted",
    in_progress: "In progress",
    waiting_office: "Waiting for office",
    parts_requested: "Parts requested",
    mechanic_done: "Mechanic done",
    closed: "Closed",
    odoo_entered: "Odoo entered",
    cancelled: "Cancelled",
  };
  return labels[status] || status;
}

export function assetLabel(asset) {
  if (!asset) return "No unit selected";
  const unit = asset.unitNo || asset.name || asset.vin || "Vehicle";
  return asset.unitType ? `${unit} (${asset.unitType})` : unit;
}

export function dashboardCard(workorder, lastMessage = null) {
  return {
    id: workorder.id,
    serial: workorder.serial,
    assetLabel: assetLabel(workorder.asset),
    assetUnitNo: workorder.asset?.unitNo || workorder.asset?.name || "",
    concern: workorder.concern,
    status: workorder.status,
    statusLabel: statusLabel(workorder.status),
    locationName: workorder.location?.name || "",
    mechanicName: workorder.mechanics?.map((mechanic) => mechanic.name).filter(Boolean).join(", ")
      || workorder.mechanic?.name
      || "",
    mechanics: workorder.mechanics || [],
    lastMessage: lastMessage?.body || "",
    updatedAt: workorder.updatedAt,
    createdAt: workorder.createdAt,
  };
}
