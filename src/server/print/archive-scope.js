function actorCanReadJob(context, job) {
  if (!job?.companyId || !context?.companyIds?.has(job.companyId)) return false;
  if (context.actor?.role === "admin") return true;
  return Boolean(job.locationId && context.locationIds?.has(job.locationId));
}

export function safeArchiveJob(job) {
  if (!job) return null;
  const { pdfPath: _pdfPath, ...safe } = job;
  return safe;
}

export function safeArchiveShare(share) {
  if (!share) return null;
  const { packagePath: _packagePath, ...safe } = share;
  return safe;
}

export function scopeArchiveLedger(ledger, context) {
  const jobs = (ledger.jobs || []).filter((job) => actorCanReadJob(context, job));
  const jobIds = new Set(jobs.map((job) => job.id));
  const serials = new Set(jobs.flatMap((job) => job.serials || []));
  const companies = Object.fromEntries(Object.entries(ledger.companies || {}).flatMap(([id, company]) => {
    if (!context?.companyIds?.has(id)) return [];
    if (context.actor?.role === "admin") return [[id, company]];
    return [[id, {
      ...company,
      issued: (company.issued || []).filter((entry) => jobIds.has(entry.jobId)),
    }]];
  }));
  const workorders = Object.fromEntries(Object.entries(ledger.workorders || {}).filter(([serial, workorder]) => {
    if (!context?.companyIds?.has(workorder.companyId)) return false;
    if (context.actor?.role === "admin") return true;
    return serials.has(serial) || (workorder.jobIds || []).some((jobId) => jobIds.has(jobId));
  }));
  const shares = (ledger.shares || []).filter((share) => {
    if (!share.companyId || !context?.companyIds?.has(share.companyId)) return false;
    if (context.actor?.role === "admin") return true;
    const sharedSerials = Array.isArray(share.serials) ? share.serials : [];
    return sharedSerials.length > 0 && sharedSerials.every((serial) => serials.has(serial));
  });
  const activity = (ledger.activity || []).filter((entry) => {
    if (!entry.companyId || !context?.companyIds?.has(entry.companyId)) return false;
    if (context.actor?.role === "admin") return true;
    if (entry.jobId) return jobIds.has(entry.jobId);
    const entrySerials = Array.isArray(entry.serials) ? entry.serials : [];
    return entrySerials.length > 0 && entrySerials.every((serial) => serials.has(serial));
  });
  return { ...ledger, companies, workorders, jobs, shares, activity };
}

export function canReadArchiveJob(context, job) {
  return actorCanReadJob(context, job);
}
