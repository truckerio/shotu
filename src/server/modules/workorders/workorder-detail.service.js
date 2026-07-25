import { listChatMessages } from "../../db/repositories/chat.repo.js";
import {
  getOperationalWorkorderById,
  getWorkorderTimeline,
  recordWorkorderOpened,
} from "../../db/repositories/operational-workorders.repo.js";
import { listWorkorderPartRequests } from "../../db/repositories/part-requests.repo.js";

function mechanicParticipants(workorder, timeline) {
  const participants = new Map();
  const currentMechanicIds = new Set([
    ...(workorder.mechanicIds || []),
    workorder.currentMechanicId,
  ].filter(Boolean));
  const include = ({ id, name, createdAt, opened = false, activity = false }) => {
    if (!id || !name) return;
    const current = participants.get(id) || {
      id,
      name,
      isCurrent: currentMechanicIds.has(id),
      firstSeenAt: createdAt || null,
      lastSeenAt: createdAt || null,
      lastOpenedAt: null,
      activityCount: 0,
    };
    if (createdAt && (!current.firstSeenAt || createdAt < current.firstSeenAt)) current.firstSeenAt = createdAt;
    if (createdAt && (!current.lastSeenAt || createdAt > current.lastSeenAt)) current.lastSeenAt = createdAt;
    if (opened && createdAt && (!current.lastOpenedAt || createdAt > current.lastOpenedAt)) current.lastOpenedAt = createdAt;
    if (activity) current.activityCount += 1;
    current.isCurrent = current.isCurrent || currentMechanicIds.has(id);
    participants.set(id, current);
  };

  for (const mechanic of workorder.mechanics || []) {
    include({
      id: mechanic.id,
      name: mechanic.name,
      createdAt: mechanic.assignedAt || workorder.acceptedAt,
    });
  }
  if (!workorder.mechanics?.length && workorder.mechanic?.id) {
    include({ id: workorder.mechanic.id, name: workorder.mechanic.name, createdAt: workorder.acceptedAt });
  }

  for (const event of timeline) {
    include({
      id: event.from_mechanic_id,
      name: event.from_mechanic_name,
      createdAt: event.created_at,
    });
    include({
      id: event.to_mechanic_id,
      name: event.to_mechanic_name,
      createdAt: event.created_at,
    });
    if (event.actor_role === "mechanic") {
      include({
        id: event.actor_user_id,
        name: event.changed_by_name,
        createdAt: event.created_at,
        opened: event.type === "access",
        activity: event.type !== "access",
      });
    }
  }

  return [...participants.values()].sort((left, right) => (
    Number(right.isCurrent) - Number(left.isCurrent)
    || new Date(left.firstSeenAt || 0) - new Date(right.firstSeenAt || 0)
  ));
}

export async function loadWorkorderDetail(workorderId) {
  const [workorder, messages, timeline, partRequests] = await Promise.all([
    getOperationalWorkorderById(workorderId),
    listChatMessages(workorderId),
    getWorkorderTimeline(workorderId),
    listWorkorderPartRequests(workorderId),
  ]);
  if (!workorder) throw new Error("Workorder not found.");
  return {
    workorder,
    messages,
    timeline,
    partRequests,
    participants: mechanicParticipants(workorder, timeline),
  };
}

export async function recordWorkorderOpen(workorderId, actor) {
  return recordWorkorderOpened({
    workorderId,
    userId: actor.id,
    actorRole: actor.role,
  });
}
