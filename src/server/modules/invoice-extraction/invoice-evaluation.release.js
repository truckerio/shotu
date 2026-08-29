export function evaluateRelease({ partitionReports, gates = {} }) {
  if (!partitionReports?.holdout) throw new Error("sealed holdout partition report is required for release evaluation");
  const { fieldResults, documentResult } = partitionReports.holdout;
  if (partitionReports.holdout.partition !== "holdout") throw new Error("release evaluation requires the sealed holdout partition report");
  const config={ minimumOccurrences:300, lowerBound:.95, criticalPoint:.98, noncriticalPoint:.97, requiredCoverage:.95, falseAcceptRate:.001, documentExact:.95, documentFalseAcceptRate:.001, ...gates };
  const failures=[];
  for(const result of fieldResults) {
    const label=`${result.fieldPath}/${result.slice}`; if(result.eligible<config.minimumOccurrences) failures.push(`${label}: insufficient occurrences`);
    if(!result.adjustedWilson || result.adjustedWilson.lower<config.lowerBound) failures.push(`${label}: adjusted lower bound`);
    const minimum=result.critical?config.criticalPoint:config.noncriticalPoint; if((result.accuracyWhenReturned??0)<minimum) failures.push(`${label}: point accuracy`);
    if(result.required&&(result.coverage??0)<config.requiredCoverage) failures.push(`${label}: coverage`);
    if(result.critical&&(result.falseAcceptRate??1)>=config.falseAcceptRate) failures.push(`${label}: false accepts`);
  }
  if((documentResult.documentExact??0)<config.documentExact) failures.push("documents: exact match");
  if((documentResult.falseAcceptRate??1)>=config.documentFalseAcceptRate) failures.push("documents: false accepts");
  return { released:failures.length===0, partition:"holdout", failures, gates:config };
}
