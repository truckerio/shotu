import crypto from "node:crypto";
import { getPool, query } from "../pool.js";

export class TemplateConflictError extends Error {
  constructor(message = "Template changed elsewhere. Reload and try again.") {
    super(message); this.name = "TemplateConflictError"; this.statusCode = 409; this.code = "TEMPLATE_VERSION_CONFLICT";
  }
}

function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function publicVersion(row) { return row ? { id: row.id, companyId: row.company_id, templateId: row.template_id, versionNumber: Number(row.version_number), state: row.state, optimisticVersion: Number(row.optimistic_version), familySchemaVersion: Number(row.family_schema_version), rendererVersion: row.renderer_version, definition: row.definition, definitionSha256: row.definition_sha256, publishedAt: row.published_at || null } : null; }
function assertInspectionAssignmentMatchesDefinition(assignment, definition) {
  if (!assignment) return;
  if (assignment.familyKey !== "inspection" || assignment.applicabilityKey !== definition.assetType) {
    const error = new Error("Template assignment unit type must match its definition.");
    error.statusCode = 400;
    error.code = "TEMPLATE_ASSIGNMENT_UNIT_MISMATCH";
    throw error;
  }
}

export async function listInspectionTemplateDefinitions({ companyId }, dependencies = {}) {
  const run = dependencies.query || query;
  const [templates, assignments] = await Promise.all([
    run(`select definition.id as definition_id,definition.company_id,definition.name,definition.applicability_key,definition.preset_key,
      version.id as id,version.company_id,version.template_id,version.version_number,version.state,version.optimistic_version,
      version.family_schema_version,version.renderer_version,version.definition,version.definition_sha256,version.published_at
      from template_definitions definition
      join lateral (select candidate.* from template_versions candidate where candidate.company_id=definition.company_id and candidate.template_id=definition.id order by candidate.version_number desc limit 1) version on true
      where definition.company_id=$1 and definition.family_key='inspection' and definition.status='active'
      order by definition.updated_at desc,definition.id`, [companyId]),
    run(`select assignment.*,definition.name as template_name,version.state as template_state
      from template_assignments assignment join template_versions version on version.id=assignment.template_version_id and version.company_id=assignment.company_id
      join template_definitions definition on definition.id=version.template_id and definition.company_id=version.company_id
      where assignment.company_id=$1 and assignment.family_key='inspection' order by assignment.location_id nulls first,assignment.applicability_key`, [companyId]),
  ]);
  return {
    templates: templates.rows.map((row) => ({ id: row.definition_id, companyId: row.company_id, name: row.name, applicabilityKey: row.applicability_key, presetKey: row.preset_key, version: publicVersion(row) })),
    assignments: assignments.rows.map((row) => ({ id: row.id, companyId: row.company_id, locationId: row.location_id || null, applicabilityKey: row.applicability_key, templateVersionId: row.template_version_id, templateName: row.template_name, version: Number(row.version) })),
  };
}

export async function createTemplateDefinition(input, dependencies = {}) {
  const pool = dependencies.pool || getPool(); const client = await pool.connect();
  try {
    await client.query("begin");
    const definition = await client.query(
      `insert into template_definitions(company_id,family_key,applicability_key,name,preset_key,created_by_user_id)
       values($1,'inspection',$2,$3,$4,$5) returning *`,
      [input.companyId, input.applicabilityKey, input.name, input.presetKey, input.actorId],
    );
    const version = await client.query(
      `insert into template_versions(company_id,template_id,version_number,family_schema_version,renderer_version,definition,definition_sha256,created_by_user_id)
       values($1,$2,1,$3,$4,$5::jsonb,$6,$7) returning *`,
      [input.companyId, definition.rows[0].id, input.definition.schemaVersion, input.definition.rendererVersion, JSON.stringify(input.definition), hash(input.definition), input.actorId],
    );
    await client.query("commit");
    return { template: definition.rows[0], version: publicVersion(version.rows[0]) };
  } catch (error) { await client.query("rollback").catch(() => {}); throw error; } finally { client.release(); }
}

export async function updateTemplateDraft(input, dependencies = {}) {
  const run = dependencies.query || query;
  const result = await run(
    `with updated as (
       update template_versions set definition=$3::jsonb,definition_sha256=$4,
         optimistic_version=optimistic_version+1,updated_at=now()
       where id=$1 and company_id=$2 and state='draft' and optimistic_version=$5 returning *
     ), renamed as (
       update template_definitions definition set name=$6,updated_at=now()
       from updated where definition.id=updated.template_id and definition.company_id=updated.company_id
     ) select * from updated`,
    [input.versionId, input.companyId, JSON.stringify(input.definition), hash(input.definition), input.expectedVersion, input.definition.label],
  );
  if (!result.rows[0]) throw new TemplateConflictError();
  return publicVersion(result.rows[0]);
}

export async function publishTemplateVersion(input, dependencies = {}) {
  const pool = dependencies.pool || getPool(); const client = await pool.connect();
  try {
    await client.query("begin");
    const published = await client.query(
      `update template_versions set state='published',published_by_user_id=$3,published_at=now(),updated_at=now()
       where id=$1 and company_id=$2 and state='draft' and optimistic_version=$4 returning *`,
      [input.versionId, input.companyId, input.actorId, input.expectedVersion],
    );
    if (!published.rows[0]) throw new TemplateConflictError();
    await client.query("commit"); return publicVersion(published.rows[0]);
  } catch (error) { await client.query("rollback").catch(() => {}); throw error; } finally { client.release(); }
}

export async function createTemplateRevision(input, dependencies = {}) {
  const pool = dependencies.pool || getPool(); const client = await pool.connect();
  try {
    await client.query("begin");
    const source = await client.query(`select * from template_versions
      where id=$1 and company_id=$2 and state='published' and optimistic_version=$3 for update`, [input.versionId,input.companyId,input.expectedVersion]);
    if (!source.rows[0]) throw new TemplateConflictError("Published template changed or cannot be revised.");
    const existingDraft = await client.query("select * from template_versions where company_id=$1 and template_id=$2 and state='draft' for update", [input.companyId,source.rows[0].template_id]);
    if (existingDraft.rows[0]) { await client.query("commit"); return publicVersion(existingDraft.rows[0]); }
    const created = await client.query(`insert into template_versions(company_id,template_id,version_number,state,family_schema_version,renderer_version,definition,definition_sha256,created_by_user_id)
      values($1,$2,(select coalesce(max(version_number),0)+1 from template_versions where company_id=$1 and template_id=$2),'draft',$3,$4,$5::jsonb,$6,$7) returning *`, [
      input.companyId,source.rows[0].template_id,source.rows[0].family_schema_version,source.rows[0].renderer_version,
      JSON.stringify(source.rows[0].definition),source.rows[0].definition_sha256,input.actorId,
    ]);
    await client.query("insert into template_audit_events(company_id,template_id,template_version_id,event_type,actor_id,details) values($1,$2,$3,'revision_created',$4,$5::jsonb)", [input.companyId,source.rows[0].template_id,created.rows[0].id,input.actorId,JSON.stringify({ predecessorVersionId:source.rows[0].id })]);
    await client.query("commit"); return publicVersion(created.rows[0]);
  } catch (error) { await client.query("rollback").catch(() => {}); throw error; } finally { client.release(); }
}

export async function publishTemplateAndAssign(input, dependencies = {}) {
  assertInspectionAssignmentMatchesDefinition(input.assignment, input.definition);
  const pool = dependencies.pool || getPool(); const client = await pool.connect();
  try {
    await client.query("begin");
    const published = await client.query(`update template_versions set state='published',definition=$5::jsonb,definition_sha256=$6,
      optimistic_version=optimistic_version+1,published_by_user_id=$3,published_at=now(),updated_at=now()
      where id=$1 and company_id=$2 and state='draft' and optimistic_version=$4
        and exists(select 1 from template_definitions definition where definition.id=template_versions.template_id and definition.company_id=template_versions.company_id and definition.family_key='inspection' and definition.applicability_key=$7)
      returning *`, [input.versionId,input.companyId,input.actorId,input.expectedVersion,JSON.stringify(input.definition),hash(input.definition),input.definition.assetType]);
    if (!published.rows[0]) throw new TemplateConflictError();
    await client.query("update template_definitions set name=$3,updated_at=now() where id=$1 and company_id=$2", [published.rows[0].template_id,input.companyId,input.definition.label]);
    let assignment = null;
    if (input.assignment) {
      if (input.assignment.companyId !== input.companyId || input.assignment.templateVersionId !== input.versionId) throw new TemplateConflictError("Template assignment does not match the published template.");
      const current = await client.query(`select * from template_assignments where company_id=$1 and location_id is not distinct from $2::uuid
        and family_key=$3 and applicability_key=$4 for update`, [input.companyId,input.assignment.locationId || null,input.assignment.familyKey,input.assignment.applicabilityKey]);
      if (Number(current.rows[0]?.version || 0) !== input.assignment.expectedVersion) throw new TemplateConflictError("Template assignment changed elsewhere.");
      assignment = current.rows[0]
        ? (await client.query("update template_assignments set template_version_id=$2,version=version+1,updated_by_user_id=$3,updated_at=now() where id=$1 returning *", [current.rows[0].id,input.versionId,input.actorId])).rows[0]
        : (await client.query(`insert into template_assignments(company_id,location_id,family_key,applicability_key,template_version_id,updated_by_user_id)
          values($1,$2,$3,$4,$5,$6) returning *`, [input.companyId,input.assignment.locationId || null,input.assignment.familyKey,input.assignment.applicabilityKey,input.versionId,input.actorId])).rows[0];
    }
    await client.query("insert into template_audit_events(company_id,template_id,template_version_id,assignment_id,event_type,actor_id,details) values($1,$2,$3,$4,'published',$5,$6::jsonb)", [input.companyId,published.rows[0].template_id,published.rows[0].id,assignment?.id || null,input.actorId,JSON.stringify({ assigned:Boolean(assignment) })]);
    await client.query("commit"); return { version:publicVersion(published.rows[0]), assignment };
  } catch (error) { await client.query("rollback").catch(() => {}); throw error; } finally { client.release(); }
}

export async function saveTemplateAssignment(input, dependencies = {}) {
  const pool = dependencies.pool || getPool(); const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[`inspection-template-assignment:${input.companyId}:${input.applicabilityKey}`]);
    const version = await client.query(`select version.id from template_versions version
      join template_definitions definition on definition.company_id=version.company_id and definition.id=version.template_id
      where version.id=$1 and version.company_id=$2 and version.state='published'
        and definition.family_key=$3 and definition.applicability_key=$4
      for share of version`, [input.templateVersionId, input.companyId, input.familyKey, input.applicabilityKey]);
    if (!version.rows[0]) throw new TemplateConflictError("Select a published template version for the same family and unit type.");
    const current = await client.query(
      `select * from template_assignments where company_id=$1 and location_id is not distinct from $2::uuid
       and family_key=$3 and applicability_key=$4 for update`,
      [input.companyId, input.locationId || null, input.familyKey, input.applicabilityKey],
    );
    if (Number(current.rows[0]?.version || 0) !== input.expectedVersion) throw new TemplateConflictError("Template assignment changed elsewhere.");
    const saved = current.rows[0]
      ? await client.query("update template_assignments set template_version_id=$2,version=version+1,updated_by_user_id=$3,updated_at=now() where id=$1 returning *", [current.rows[0].id, input.templateVersionId, input.actorId])
      : await client.query(`insert into template_assignments(company_id,location_id,family_key,applicability_key,template_version_id,updated_by_user_id)
          values($1,$2,$3,$4,$5,$6) returning *`, [input.companyId, input.locationId || null, input.familyKey, input.applicabilityKey, input.templateVersionId, input.actorId]);
    await client.query("commit"); return saved.rows[0];
  } catch (error) { await client.query("rollback").catch(() => {}); throw error; } finally { client.release(); }
}

export async function archiveInspectionTemplateVersion(input,dependencies={}){
  const pool=dependencies.pool||getPool();const client=await pool.connect();const replacements=[...(input.replacements||[])].sort((a,b)=>a.assignmentId.localeCompare(b.assignmentId));const requestSha256=hash({templateVersionId:input.versionId,expectedVersion:input.expectedVersion,replacements,actorId:input.actorId});
  try{await client.query("begin");await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[`${input.companyId}:${input.actorId}:${input.idempotencyKey}`]);const replay=await client.query(`select command.template_version_id,command.request_sha256 from template_archive_commands command where command.company_id=$1 and command.actor_id=$2 and command.idempotency_key=$3 for update`,[input.companyId,input.actorId,input.idempotencyKey]);if(replay.rows[0]){if(replay.rows[0].request_sha256!==requestSha256)throw new TemplateConflictError("That idempotency key was already used for a different template archive.");const version=(await client.query("select * from template_versions where company_id=$1 and id=$2",[input.companyId,replay.rows[0].template_version_id])).rows[0];const evidence=await client.query("select assignment_id,replacement_version_id,assignment_version_after from template_archive_command_replacements where company_id=$1 and command_id=(select id from template_archive_commands where company_id=$1 and actor_id=$2 and idempotency_key=$3) order by assignment_id",[input.companyId,input.actorId,input.idempotencyKey]);await client.query("commit");return{version:publicVersion(version),replacements:evidence.rows.map((entry)=>({assignmentId:entry.assignment_id,replacementVersionId:entry.replacement_version_id,assignmentVersion:Number(entry.assignment_version_after)})),replayed:true};}
    const scope=(await client.query(`select version.id,definition.family_key,definition.applicability_key from template_versions version join template_definitions definition on definition.company_id=version.company_id and definition.id=version.template_id where version.company_id=$1 and version.id=$2 and definition.family_key='inspection'`,[input.companyId,input.versionId])).rows[0];if(!scope)throw new TemplateConflictError("Template version was not found.");await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[`inspection-template-assignment:${input.companyId}:${scope.applicability_key}`]);const target=(await client.query(`select version.*,definition.family_key,definition.applicability_key from template_versions version join template_definitions definition on definition.company_id=version.company_id and definition.id=version.template_id where version.company_id=$1 and version.id=$2 and version.state='published' and version.optimistic_version=$3 and definition.family_key='inspection' for update of version`,[input.companyId,input.versionId,input.expectedVersion])).rows[0];if(!target)throw new TemplateConflictError("Published template changed or cannot be archived.");const assignments=(await client.query("select * from template_assignments where company_id=$1 and template_version_id=$2 and family_key='inspection' order by id for update",[input.companyId,target.id])).rows;const byId=new Map(replacements.map((entry)=>[entry.assignmentId,entry]));if(assignments.length!==replacements.length||assignments.some((assignment)=>!byId.has(assignment.id)))throw new TemplateConflictError("Replace every active assignment before archiving this template.");
    const saved=[];for(const assignment of assignments){const replacement=byId.get(assignment.id);if(Number(assignment.version)!==Number(replacement.expectedVersion))throw new TemplateConflictError("Template assignment changed elsewhere.");if(replacement.replacementVersionId===target.id)throw new TemplateConflictError("Replacement must use a different published template version.");const eligible=(await client.query(`select replacement.id from template_versions replacement join template_definitions definition on definition.company_id=replacement.company_id and definition.id=replacement.template_id where replacement.company_id=$1 and replacement.id=$2 and replacement.state='published' and definition.family_key=$3 and definition.applicability_key=$4 for share of replacement`,[input.companyId,replacement.replacementVersionId,assignment.family_key,assignment.applicability_key])).rows[0];if(!eligible)throw new TemplateConflictError("Replacement must be a published template for the same family and applicability.");const updated=(await client.query("update template_assignments set template_version_id=$2,version=version+1,updated_by_user_id=$3,updated_at=now() where company_id=$1 and id=$4 and version=$5 and template_version_id=$6 returning *",[input.companyId,replacement.replacementVersionId,input.actorId,assignment.id,assignment.version,target.id])).rows[0];if(!updated)throw new TemplateConflictError("Template assignment changed elsewhere.");saved.push({before:assignment,after:updated});}
    const archived=(await client.query("update template_versions set state='archived',optimistic_version=optimistic_version+1,updated_at=now() where company_id=$1 and id=$2 and state='published' and optimistic_version=$3 returning *",[input.companyId,target.id,input.expectedVersion])).rows[0];if(!archived)throw new TemplateConflictError();const command=(await client.query("insert into template_archive_commands(company_id,template_version_id,actor_id,idempotency_key,request_sha256) values($1,$2,$3,$4,$5) returning *",[input.companyId,target.id,input.actorId,input.idempotencyKey,requestSha256])).rows[0];for(const entry of saved){await client.query("insert into template_archive_command_replacements(company_id,command_id,assignment_id,archived_version_id,replacement_version_id,assignment_version_before,assignment_version_after) values($1,$2,$3,$4,$5,$6,$7)",[input.companyId,command.id,entry.before.id,target.id,entry.after.template_version_id,entry.before.version,entry.after.version]);await client.query("insert into template_audit_events(company_id,template_id,template_version_id,assignment_id,event_type,actor_id,details) values($1,$2,$3,$4,'assignment_replaced_for_archive',$5,$6::jsonb)",[input.companyId,target.template_id,target.id,entry.before.id,input.actorId,JSON.stringify({replacementVersionId:entry.after.template_version_id,assignmentVersionBefore:Number(entry.before.version),assignmentVersionAfter:Number(entry.after.version)})]);}await client.query("insert into template_audit_events(company_id,template_id,template_version_id,event_type,actor_id,details) values($1,$2,$3,'archived',$4,$5::jsonb)",[input.companyId,target.template_id,target.id,input.actorId,JSON.stringify({replacementCount:saved.length,commandId:command.id})]);await client.query("commit");return{version:publicVersion(archived),replacements:saved.map((entry)=>({assignmentId:entry.after.id,replacementVersionId:entry.after.template_version_id,assignmentVersion:Number(entry.after.version)})),replayed:false};
  }catch(error){await client.query("rollback").catch(()=>{});throw error;}finally{client.release();}
}

export async function resolvePublishedTemplateForInspection(client, { companyId, locationId, unitType, actorId }) {
  await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[`inspection-template-assignment:${companyId}:${unitType}`]);
  const readAssigned = () => client.query(
    `select version.* from template_assignments assignment
     join template_versions version on version.company_id=assignment.company_id and version.id=assignment.template_version_id
     where assignment.company_id=$1 and assignment.family_key='inspection' and assignment.applicability_key=$3
       and assignment.location_id is not distinct from coalesce(
         (select location_id from template_assignments where company_id=$1 and location_id=$2 and family_key='inspection' and applicability_key=$3),
         null::uuid)
       and version.state='published'
     order by (assignment.location_id is not null) desc limit 1 for share of assignment, version`,
    [companyId, locationId, unitType],
  );
  const result = await readAssigned();
  return publicVersion(result.rows[0]);
}

export const templateRepositoryInternals = { hash, publicVersion, assertInspectionAssignmentMatchesDefinition };
