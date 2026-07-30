import { requireActor, requireCompanyAccess } from "../../auth/authorize.js";
import { invalidRequest, permissionDenied, resourceNotFound } from "../../auth/errors.js";
import {
  listActiveProofreadingDictionaryTerms,
  removeProofreadingDictionaryTerm,
  saveProofreadingDictionaryTerm,
} from "../../db/repositories/proofreading-dictionaries.repo.js";

export const MAX_PROOFREADING_DICTIONARY_TERMS = 500;
const TERM_PATTERN = /^\p{L}+(?:[ '\-’]\p{L}+)*$/u;

export function normalizeProofreadingDictionaryTerm(value) {
  if (typeof value !== "string") throw invalidRequest("Dictionary term must be text.");
  const displayTerm = value
    .normalize("NFKC")
    .replaceAll("’", "'")
    .trim()
    .replace(/\s+/g, " ");
  const length = [...displayTerm].length;
  if (length < 2 || length > 64) {
    throw invalidRequest("Dictionary terms must be between 2 and 64 characters.");
  }
  if (!TERM_PATTERN.test(displayTerm)) {
    throw invalidRequest("Dictionary terms may contain only letters, apostrophes, hyphens, and spaces.");
  }
  return {
    displayTerm,
    normalizedTerm: displayTerm.toLocaleLowerCase("en-US"),
  };
}

function selectedCompanyId(context, requestedCompanyId) {
  requireActor(context);
  const companyIds = [...(context.companyIds || [])];
  const companyId = String(requestedCompanyId || (companyIds.length === 1 ? companyIds[0] : "")).trim();
  if (!companyId) throw invalidRequest("Select a company.");
  requireCompanyAccess(context, companyId);
  return companyId;
}

function requireCompanyAdmin(context) {
  const actor = requireActor(context);
  if (actor.role !== "admin") throw permissionDenied();
  return actor;
}

function present(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    ownerUserId: row.owner_user_id || null,
    scope: row.owner_user_id ? "personal" : "company",
    term: row.display_term,
    normalizedTerm: row.normalized_term,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

export async function listProofreadingDictionary(context, input = {}, dependencies = {}) {
  const actor = requireActor(context);
  const companyId = selectedCompanyId(context, input.companyId);
  const listTerms = dependencies.listTerms || listActiveProofreadingDictionaryTerms;
  const rows = await listTerms({
    companyId,
    ownerUserId: actor.id,
    limit: MAX_PROOFREADING_DICTIONARY_TERMS,
  });
  return rows.map(present);
}

export async function addPersonalProofreadingTerm(context, input, dependencies = {}) {
  const actor = requireActor(context);
  const companyId = selectedCompanyId(context, input?.companyId);
  const term = normalizeProofreadingDictionaryTerm(input?.term);
  const saveTerm = dependencies.saveTerm || saveProofreadingDictionaryTerm;
  return present(await saveTerm({
    actorUserId: actor.id,
    companyId,
    ownerUserId: actor.id,
    ...term,
  }));
}

export async function removePersonalProofreadingTerm(context, input, dependencies = {}) {
  const actor = requireActor(context);
  const companyId = selectedCompanyId(context, input?.companyId);
  const { normalizedTerm } = normalizeProofreadingDictionaryTerm(input?.term);
  const removeTerm = dependencies.removeTerm || removeProofreadingDictionaryTerm;
  const removed = await removeTerm({
    actorUserId: actor.id,
    companyId,
    ownerUserId: actor.id,
    normalizedTerm,
  });
  if (!removed) throw resourceNotFound("Dictionary term");
  return present(removed);
}

export async function addCompanyProofreadingTerm(context, input, dependencies = {}) {
  const actor = requireCompanyAdmin(context);
  const companyId = selectedCompanyId(context, input?.companyId);
  const term = normalizeProofreadingDictionaryTerm(input?.term);
  const saveTerm = dependencies.saveTerm || saveProofreadingDictionaryTerm;
  return present(await saveTerm({
    actorUserId: actor.id,
    companyId,
    ownerUserId: null,
    ...term,
  }));
}

export async function removeCompanyProofreadingTerm(context, input, dependencies = {}) {
  const actor = requireCompanyAdmin(context);
  const companyId = selectedCompanyId(context, input?.companyId);
  const { normalizedTerm } = normalizeProofreadingDictionaryTerm(input?.term);
  const removeTerm = dependencies.removeTerm || removeProofreadingDictionaryTerm;
  const removed = await removeTerm({
    actorUserId: actor.id,
    companyId,
    ownerUserId: null,
    normalizedTerm,
  });
  if (!removed) throw resourceNotFound("Dictionary term");
  return present(removed);
}
