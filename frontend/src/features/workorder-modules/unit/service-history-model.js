import { interfaceText, intlLocale } from "../../../i18n/index.js";

const HISTORY_STATES = new Set(["ready", "empty", "unlinked", "never_synced", "stale", "unavailable"]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeServiceHistoryResponse(payload = {}) {
  const rawState = text(payload.state).toLowerCase().replace(/-/g, "_");
  const items = list(payload.items).map((item, index) => ({
    id: text(item?.id) || `service-${index}`,
    reference: text(item?.reference),
    source: text(item?.source),
    serviceDate: text(item?.serviceDate || item?.completedAt || item?.date),
    dateKind: text(item?.dateKind),
    concern: text(item?.concern),
    diagnosis: text(item?.diagnosis),
    workPerformed: text(item?.workPerformed || item?.work_performed),
    serviceLines: list(item?.serviceLines).map(text).filter(Boolean),
    parts: list(item?.parts).map((part) => ({
      id: text(part?.id || part?.partId),
      name: text(part?.name || part?.description || part?.partNumber),
      quantity: part?.quantity ?? part?.qty ?? "",
    })),
    truncated: Object.fromEntries([
      "reference", "status", "concern", "diagnosis", "workPerformed", "serviceLines", "parts",
    ].map((key) => [key, item?.truncated?.[key] === true])),
  }));
  const requestedState = HISTORY_STATES.has(rawState) ? rawState : "";
  const inferredState = rawState ? "unavailable" : (items.length ? "ready" : "empty");

  return {
    state: requestedState || inferredState,
    unit: payload.unit && typeof payload.unit === "object" ? payload.unit : null,
    summary: {
      historyCount: count(payload.summary?.historyCount ?? payload.historyCount ?? items.length),
      lastCompletedServiceAt: text(payload.summary?.lastCompletedServiceAt),
      latestRecordedServiceAt: text(payload.summary?.latestRecordedServiceAt),
    },
    freshness: {
      state: text(payload.freshness?.state).toLowerCase().replace(/-/g, "_"),
      lastSucceededAt: text(payload.freshness?.lastSucceededAt),
      warning: text(payload.freshness?.warning),
    },
    items,
    nextCursor: text(payload.nextCursor),
  };
}

export function serviceHistoryStatus(history, locale = "en", { includeDiagnostic = false } = {}) {
  const t = (key) => interfaceText(locale, key);
  if (!history) return { title: t("history.loadingTitle"), message: "" };
  if (history.state === "unlinked") return { title: t("history.unitNotMatched"), message: t("history.unitNotLinked") };
  if (history.state === "never_synced") return { title: t("history.notSynced"), message: t("history.askAdmin") };
  if (history.state === "stale") return { title: t("history.outdated"), message: includeDiagnostic && history.freshness.warning ? history.freshness.warning : t("history.latestShown") };
  if (history.state === "unavailable") return { title: t("history.unavailable"), message: includeDiagnostic && history.freshness.warning ? history.freshness.warning : t("history.tryAgain") };
  if (history.state === "empty") return { title: t("history.noneFound"), message: t("history.noneExist") };
  return { title: t("history.title"), message: "" };
}

export function serviceHistoryDateLabel(dateKind, locale = "en") {
  return ({
    verified_completed: interfaceText(locale, "history.completed"),
    work_done: interfaceText(locale, "history.workDone"),
    recorded: interfaceText(locale, "history.recorded"),
    scheduled: interfaceText(locale, "history.scheduled"),
  })[text(dateKind).toLowerCase()] || interfaceText(locale, "history.serviceDate");
}

export function serviceHistorySourceLabel(source, locale = "en") {
  return ({
    odoo: interfaceText(locale, "history.odooOrder"),
    local: interfaceText(locale, "history.localWorkorder"),
    local_inspection: interfaceText(locale, "history.localInspection"),
  })[text(source).toLowerCase()] || text(source);
}

export function formatServiceHistoryDate(value, locale = "en") {
  if (!value) return interfaceText(locale, "history.dateNotRecorded");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(intlLocale(locale), { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export function serviceHistorySummaryLabel(history, locale = "en") {
  const t = (key) => interfaceText(locale, key);
  if (!history) return t("history.loadingPrevious");
  if (history.state === "unlinked" || history.state === "never_synced" || history.state === "unavailable") return serviceHistoryStatus(history, locale).title;
  if (history.summary.lastCompletedServiceAt) {
    return `${t("history.lastCompleted")} · ${formatServiceHistoryDate(history.summary.lastCompletedServiceAt, locale)}`;
  }
  if (history.summary.latestRecordedServiceAt) {
    return `${t("history.latestRecord")} · ${formatServiceHistoryDate(history.summary.latestRecordedServiceAt, locale)}`;
  }
  return history.state === "stale" ? t("history.outdated") : t("history.noneFound");
}
