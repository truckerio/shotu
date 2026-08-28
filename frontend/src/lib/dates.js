import { intlLocale } from "../i18n/index.js";

function localeOrBrowser(locale) {
  return locale ? intlLocale(locale) : undefined;
}

export function formatCreatedAt(value, locale) {
  if (!value) return "Date not set";
  return new Date(value).toLocaleString(localeOrBrowser(locale), {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatChatTime(value, locale) {
  if (!value) return "";
  return new Date(value).toLocaleString(localeOrBrowser(locale), {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ageLabel(value, locale) {
  if (!value) return "";
  const diffMs = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return "";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes).toLocaleString(localeOrBrowser(locale))}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours.toLocaleString(localeOrBrowser(locale))}h`;
  return `${Math.floor(hours / 24).toLocaleString(localeOrBrowser(locale))}d`;
}

export function durationLabel(seconds, locale) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return "";
  if (value < 60) return "<1m";
  const minutes = Math.floor(value / 60);
  if (minutes < 60) return `${minutes.toLocaleString(localeOrBrowser(locale))}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours.toLocaleString(localeOrBrowser(locale))}h`;
  return `${Math.floor(hours / 24).toLocaleString(localeOrBrowser(locale))}d`;
}
