import { randomUUID } from "node:crypto";

export const ROLE_WORKFLOW_STEPS = Object.freeze([
  "admin-create",
  "authorization-boundaries",
  "office-assign",
  "mechanic-accept",
  "chat-and-parts",
  "office-part-decision",
  "mechanic-done",
  "office-close",
  "surveillance-odoo-readiness",
]);

function lifecycle(workorder) {
  return workorder?.lifecycle || workorder?.status || "";
}

export function assertLifecycle(workorder, expected, stage) {
  const actual = lifecycle(workorder);
  if (actual !== expected) {
    throw new Error(`${stage} expected lifecycle ${expected}, received ${actual || "unknown"}.`);
  }
}

export function assertOdooReadiness(readiness) {
  if (typeof readiness?.ready !== "boolean") {
    throw new Error("Canonical Odoo readiness did not return a boolean ready state.");
  }
  if (!readiness.ready && !readiness.blockers?.length) {
    throw new Error("Blocked Odoo readiness did not explain what setup is missing.");
  }
  return {
    ready: readiness.ready,
    blockerCodes: (readiness.blockers || []).map((blocker) => blocker.code),
  };
}

export function chooseWorkflowLocations(locations, { primaryName, scopedLocationIds = [] }) {
  const active = locations.filter((location) => location.active !== false);
  const primary = active.find((location) => location.name === primaryName);
  if (!primary) throw new Error(`Active QA location ${primaryName} was not returned by the admin API.`);
  const scoped = new Set(scopedLocationIds);
  const restricted = active.find((location) => (
    location.id !== primary.id
    && location.company_id === primary.company_id
    && !scoped.has(location.id)
  ));
  if (!restricted) {
    throw new Error("A second active company location outside the QA office/mechanic scope is required for authorization checks.");
  }
  return { primary, restricted };
}

export function buildWorkorderInput({ location, concern, mechanicUserIds = [] }) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    companyId: location.company_id,
    locationId: location.id,
    concern,
    officeNotes: "Created by the deterministic QA role workflow.",
    mechanicUserIds,
    formData: {
      date: today,
      startDate: today,
      endDate: today,
      mechanicConcern: concern,
      customerCompanyName: "QA Workflow",
      parts: [],
    },
  };
}

async function expectDenied(client, path, { method = "GET", body } = {}) {
  const result = await client.request(path, {
    method,
    body,
    expectedStatuses: [403, 404],
  });
  if (![403, 404].includes(result.status)) {
    throw new Error(`${client.role} unexpectedly accessed ${path}.`);
  }
  return result.status;
}

function workorderFrom(result, stage) {
  const workorder = result.body?.workorder;
  if (!workorder?.id) throw new Error(`${stage} did not return a workorder.`);
  return workorder;
}

export async function runApiRoleWorkflow({ clients, config, logger = console }) {
  const runId = `qa-e2e-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const trace = [];
  const record = (stage, detail = {}) => {
    trace.push({ stage, ...detail });
    logger.log(`[role-workflow] ${stage}`);
  };

  const actors = Object.fromEntries(await Promise.all(
    Object.entries(clients).map(async ([role, client]) => [
      role,
      await client.authenticate(config.accounts[role]),
    ]),
  ));
  const adminLocations = await clients.admin.request("/api/admin/locations");
  const scopedLocationIds = [
    ...(actors.office.locationIds || []),
    ...(actors.mechanic.locationIds || []),
    ...(actors.surveillance.locationIds || []),
  ];
  const { primary, restricted } = chooseWorkflowLocations(adminLocations.body?.locations || [], {
    primaryName: config.locationName,
    scopedLocationIds,
  });
  if (!(actors.mechanic.locationIds || []).includes(primary.id)) {
    throw new Error("The deterministic mechanic is not assigned to the configured QA location.");
  }

  const mainConcern = `QA complete role workflow ${runId}`;
  const restrictedConcern = `QA authorization boundary ${runId}`;
  const created = await clients.admin.request("/api/office/workorders", {
    method: "POST",
    body: buildWorkorderInput({ location: primary, concern: mainConcern }),
  });
  let workorder = workorderFrom(created, "admin create");
  assertLifecycle(workorder, "open", "admin create");
  record("admin-create", { workorderId: workorder.id, serial: workorder.serial });

  const restrictedCreated = await clients.admin.request("/api/office/workorders", {
    method: "POST",
    body: buildWorkorderInput({ location: restricted, concern: restrictedConcern }),
  });
  const restrictedWorkorder = workorderFrom(restrictedCreated, "restricted create");

  await Promise.all([
    expectDenied(clients.office, `/api/office/workorders/${restrictedWorkorder.id}`),
    expectDenied(clients.mechanic, `/api/mechanic/workorders/${restrictedWorkorder.id}`),
    expectDenied(clients.surveillance, `/api/surveillance/workorders/${restrictedWorkorder.id}`),
    expectDenied(clients.mechanic, "/api/office/dashboard"),
    expectDenied(clients.office, "/api/mechanic/dashboard"),
    expectDenied(clients.surveillance, "/api/office/dashboard"),
  ]);
  record("authorization-boundaries", { restrictedWorkorderId: restrictedWorkorder.id });

  const assigned = await clients.office.request(`/api/office/workorders/${workorder.id}/assignments`, {
    method: "POST",
    body: { mechanicUserIds: [actors.mechanic.id], reason: "QA office assignment" },
  });
  workorder = workorderFrom(assigned, "office assignment");
  assertLifecycle(workorder, "accepted", "office assignment");
  if (!workorder.mechanicIds?.includes(actors.mechanic.id)) {
    throw new Error("Office assignment did not grant the QA mechanic workorder access.");
  }
  await clients.mechanic.request(`/api/mechanic/workorders/${workorder.id}`);
  record("office-assign");

  const unassigned = await clients.office.request(`/api/office/workorders/${workorder.id}/assignments`, {
    method: "POST",
    body: { mechanicUserIds: [], reason: "QA verify available queue acceptance" },
  });
  assertLifecycle(workorderFrom(unassigned, "office unassignment"), "open", "office unassignment");
  const accepted = await clients.mechanic.request(`/api/mechanic/workorders/${workorder.id}/accept`, {
    method: "POST",
    body: {},
  });
  workorder = workorderFrom(accepted, "mechanic accept");
  assertLifecycle(workorder, "in_progress", "mechanic accept");
  const duplicateAccept = await clients.mechanic.request(`/api/mechanic/workorders/${workorder.id}/accept`, {
    method: "POST",
    body: {},
    expectedStatuses: [409],
  });
  if (duplicateAccept.body?.code !== "WORKORDER_ALREADY_ACCEPTED") {
    throw new Error("A duplicate mechanic accept did not return WORKORDER_ALREADY_ACCEPTED.");
  }
  record("mechanic-accept");

  const chatBody = `QA status update completed at ${Date.now()}.`;
  const partNumber = `QA-${runId.slice(-8).toUpperCase()}`;
  await clients.mechanic.request(`/api/mechanic/workorders/${workorder.id}/messages`, {
    method: "POST",
    body: { clientMessageId: randomUUID(), messageType: "normal", body: chatBody },
  });
  const partResult = await clients.mechanic.request(`/api/mechanic/workorders/${workorder.id}/parts`, {
    method: "POST",
    body: {
      query: partNumber,
      partNumber,
      description: "Deterministic QA workflow part",
      quantity: 1,
      uomCode: "pc",
      repairOrder: "Install during QA workflow",
      fitmentStatus: "confirmed",
      fitmentNotes: "Synthetic test data",
    },
  });
  if (!partResult.body?.partRequest?.id) throw new Error("Mechanic part request was not created.");
  const mechanicDetail = await clients.mechanic.request(`/api/mechanic/workorders/${workorder.id}`);
  if (!mechanicDetail.body?.messages?.some((message) => message.body === chatBody)) {
    throw new Error("Mechanic chat message was not visible in workorder detail.");
  }
  if (!mechanicDetail.body?.partRequests?.some((part) => part.partNumber === partNumber)) {
    throw new Error("Mechanic part request was not visible in workorder detail.");
  }
  record("chat-and-parts", { partRequestId: partResult.body.partRequest.id });

  const partDecision = await clients.office.request(
    `/api/office/workorders/${workorder.id}/parts/${partResult.body.partRequest.id}/decision`,
    {
      method: "POST",
      body: {
        decision: "rejected",
        quantity: 1,
        uomCode: "pc",
        reason: "Synthetic acceptance request does not consume inventory.",
      },
    },
  );
  if (partDecision.body?.partRequest?.approvalStatus !== "rejected") {
    throw new Error("Office part decision did not resolve the synthetic request.");
  }
  record("office-part-decision", { decision: "rejected" });

  const done = await clients.mechanic.request(`/api/mechanic/workorders/${workorder.id}/mark-done`, {
    method: "POST",
    body: {
      diagnosis: "QA workflow diagnosis complete.",
      workPerformed: "QA workflow repair complete.",
      confirmationName: actors.mechanic.name,
    },
  });
  workorder = workorderFrom(done, "mechanic done");
  assertLifecycle(workorder, "mechanic_done", "mechanic done");
  record("mechanic-done");

  const closed = await clients.office.request(`/api/office/workorders/${workorder.id}/close`, {
    method: "POST",
    body: { note: "QA office approval complete." },
  });
  workorder = workorderFrom(closed, "office close");
  assertLifecycle(workorder, "closed", "office close");
  record("office-close");

  const surveillanceBefore = await clients.surveillance.request("/api/surveillance/dashboard");
  if (!surveillanceBefore.body?.pendingOdoo?.some((item) => item.id === workorder.id)) {
    throw new Error("Closed workorder was not present in the Surveillance Odoo backlog.");
  }
  const odooReadinessResult = await clients.surveillance.request(
    `/api/workorders/${workorder.id}/modules/odoo/readiness`,
  );
  const odooReadiness = assertOdooReadiness(odooReadinessResult.body);
  const finalDetail = await clients.surveillance.request(`/api/surveillance/workorders/${workorder.id}`);
  assertLifecycle(finalDetail.body?.workorder, "closed", "surveillance Odoo readiness");
  record("surveillance-odoo-readiness", {
    ready: odooReadiness.ready,
    blockerCodes: odooReadiness.blockerCodes,
  });

  await clients.admin.request(`/api/office/workorders/${restrictedWorkorder.id}/cancel`, {
    method: "POST",
    body: { reason: "QA authorization boundary complete" },
  });

  return {
    runId,
    workorderId: workorder.id,
    serial: workorder.serial,
    concern: mainConcern,
    chatBody,
    partNumber,
    odooReadiness: {
      ready: odooReadiness.ready,
      blockerCodes: odooReadiness.blockerCodes,
    },
    restrictedWorkorderId: restrictedWorkorder.id,
    trace,
  };
}
