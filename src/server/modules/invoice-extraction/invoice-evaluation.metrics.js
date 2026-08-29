import { ALL_FIELD_PATHS, EVALUATION_NORMALIZER_VERSION, LINE_FIELD_PATHS, predictionCaseSchema, validateCorpus } from "./invoice-evaluation.contract.js";
import { FIXED_ARITHMETIC_TOLERANCE, isReturned, typedValuesEqual } from "./invoice-evaluation.normalization.js";

// Acklam's rational approximation is deterministic and avoids a provider/math dependency.
function inverseNormal(p) {
  if (!(p > 0 && p < 1)) throw new RangeError("probability must be between zero and one");
  const a=[-39.6968302866538,220.946098424521,-275.928510446969,138.357751867269,-30.6647980661472,2.50662827745924];
  const b=[-54.4760987982241,161.585836858041,-155.698979859887,66.8013118877197,-13.2806815528857];
  const c=[-0.00778489400243029,-0.322396458041136,-2.40075827716184,-2.54973253934373,4.37466414146497,2.93816398269878];
  const d=[0.00778469570904146,0.32246712907004,2.445134137143,3.75440866190742]; let q; let r;
  if (p < .02425) { q=Math.sqrt(-2*Math.log(p)); return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
  if (p > .97575) { q=Math.sqrt(-2*Math.log(1-p)); return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
  q=p-.5; r=q*q; return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}

export function wilsonInterval(correct, total, confidenceLevel = .95) {
  if (!Number.isInteger(correct) || !Number.isInteger(total) || correct < 0 || total < correct) throw new RangeError("invalid binomial count");
  if (!total) return null;
  const z = inverseNormal(1 - (1 - confidenceLevel) / 2); const n = total; const p = correct / n; const denom = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denom; const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / denom;
  return { confidenceLevel, lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

// A predeclared Bonferroni simultaneous interval controls family-wise error without
// using observed results to choose an ordering. It is intentionally conservative.
export function simultaneousAdjustedWilsonBounds(hypotheses, familyAlpha = .05) {
  const ordered = [...hypotheses].sort((a,b) => a.key.localeCompare(b.key)); const m = ordered.length;
  return Object.fromEntries(ordered.map((item, index) => {
    const alpha = familyAlpha / Math.max(1, m); const confidenceLevel = 1 - alpha;
    return [item.key, { alpha, interval: wilsonInterval(item.correct, item.total, confidenceLevel) }];
  }));
}

function fieldValue(draft, fieldPath, row) { return row !== null ? draft.lines?.[row]?.[fieldPath]?.value : draft?.[fieldPath]?.value; }
function truthValue(truth, fieldPath, row) { return row !== null ? truth.lines?.[row]?.[fieldPath] : truth?.[fieldPath]; }

export function evaluateField({ fieldPath, cases, predictions, slice = null, required = false, critical = false, acceptedConfidence = 90 }) {
  const byId = new Map(predictions.map((item) => [item.caseId, predictionCaseSchema.parse(item)]));
  const counts = { eligible:0, returned:0, correct:0, abstained:0, wrongReturned:0, falseAccepts:0, accepted:0, presenceTp:0, presenceFp:0, presenceFn:0 };
  for (const item of cases) {
    if (slice && !item.slices.includes(slice)) continue;
    const rows = LINE_FIELD_PATHS.includes(fieldPath) ? item.labels.truthDraft.lines.map((_, index) => index) : [null];
    const predicted = byId.get(item.caseId);
    for (const row of rows) {
      const truth = truthValue(item.labels.truthDraft, fieldPath, row); if (!truth?.applicable) continue;
      counts.eligible += 1; const actual = predicted ? fieldValue(predicted.draft, fieldPath, row) : null; const returned = isReturned(actual); const truthPresent = isReturned(truth.value);
      const accepted = Boolean(predicted?.decision.accepted && Number(fieldValue(predicted.draft, fieldPath, row) === null ? 0 : (row === null ? predicted.draft[fieldPath]?.confidence : predicted.draft.lines?.[row]?.[fieldPath]?.confidence)) >= acceptedConfidence);
      if (returned) counts.returned += 1; else counts.abstained += 1;
      const correct = returned && typedValuesEqual(fieldPath, actual, truth.value);
      if (correct) counts.correct += 1; else if (returned) counts.wrongReturned += 1;
      if (accepted) { counts.accepted += 1; if (!correct) counts.falseAccepts += 1; }
      if (returned && truthPresent) counts.presenceTp += 1; else if (returned) counts.presenceFp += 1; else if (truthPresent) counts.presenceFn += 1;
    }
  }
  const divide=(a,b)=>b?a/b:null; const precision=divide(counts.presenceTp,counts.presenceTp+counts.presenceFp); const recall=divide(counts.presenceTp,counts.presenceTp+counts.presenceFn);
  return { fieldPath, slice, required, critical, ...counts, accuracyWhenReturned:divide(counts.correct,counts.returned), coverage:divide(counts.returned,counts.eligible), endToEndSuccess:divide(counts.correct,counts.eligible), falseAcceptRate:divide(counts.falseAccepts,counts.eligible), falseAcceptRateWhenAccepted:divide(counts.falseAccepts,counts.accepted), presence:{precision,recall,f1:precision!==null&&recall!==null&&precision+recall?2*precision*recall/(precision+recall):null}, nominalWilson:wilsonInterval(counts.correct,counts.eligible) };
}

export function evaluateDocuments({ cases, predictions, criticalFields = ALL_FIELD_PATHS }) {
  const byId=new Map(predictions.map((item)=>[item.caseId,item])); let eligible=0; let correct=0; let accepted=0; let falseAccepts=0;
  for (const item of cases) { const truth=item.labels.truthDraft; const prediction=byId.get(item.caseId); eligible += 1; const scalarOk=criticalFields.filter((f)=>!LINE_FIELD_PATHS.includes(f)).every((f)=>!truth[f].applicable || typedValuesEqual(f, prediction?.draft?.[f]?.value, truth[f].value));
    const linesOk=truth.lines.length === (prediction?.draft?.lines?.length || 0) && truth.lines.every((line,i)=>criticalFields.filter((f)=>LINE_FIELD_PATHS.includes(f)).every((f)=>!line[f].applicable || typedValuesEqual(f,prediction?.draft?.lines?.[i]?.[f]?.value,line[f].value)));
    const reconciliationOk=deterministicallyReconciles(prediction?.draft); const ok=scalarOk&&linesOk&&reconciliationOk; if(ok) correct+=1; if(prediction?.decision.accepted){accepted+=1;if(!ok)falseAccepts+=1;}
  }
  return {eligible,correct,accepted,falseAccepts,documentExact:eligible?correct/eligible:null,falseAcceptRate:eligible?falseAccepts/eligible:null,nominalWilson:wilsonInterval(correct,eligible)};
}

export function deterministicallyReconciles(draft) {
  if (!draft || (draft.warnings || []).length) return false;
  const value = (field) => draft[field]?.value;
  const scalar = [value("subtotal"), value("tax"), value("shipping"), value("total")];
  if (scalar.some((item) => !Number.isFinite(item))) return false;
  const lineTotals=(draft.lines || []).map((line)=>line.lineTotal?.value);
  if (!lineTotals.length || lineTotals.some((item)=>!Number.isFinite(item))) return false;
  const lineSum=lineTotals.reduce((sum,item)=>sum+item,0);
  return Math.abs(lineSum-value("subtotal"))<=FIXED_ARITHMETIC_TOLERANCE && Math.abs(value("subtotal")+value("tax")+value("shipping")-value("total"))<=FIXED_ARITHMETIC_TOLERANCE;
}

function partitionReport({ partition, cases, predictions, fields, slices, requiredFields, criticalFields }) {
  const fieldResults=[];
  for(const fieldPath of fields) for(const slice of slices) fieldResults.push(evaluateField({fieldPath,cases,predictions,slice,required:requiredFields.includes(fieldPath),critical:criticalFields.includes(fieldPath)}));
  const adjusted=simultaneousAdjustedWilsonBounds(fieldResults.map((r)=>({key:`${r.fieldPath}\u0000${r.slice}`,correct:r.correct,total:r.eligible})));
  for(const result of fieldResults) { result.adjustment="bonferroni-simultaneous"; result.adjustedWilson=adjusted[`${result.fieldPath}\u0000${result.slice}`].interval; }
  return { partition, caseCount:cases.length, fieldResults, documentResult:evaluateDocuments({cases,predictions,criticalFields}) };
}

export function evaluateRun({ registryHash, normalizerVersion = EVALUATION_NORMALIZER_VERSION, corpus, predictions, fields = ALL_FIELD_PATHS, requiredFields = fields, criticalFields = fields }) {
  validateCorpus({ corpus, registryHash, normalizerVersion }); const corpusIds=new Set(corpus.map((item)=>item.caseId)); const predictionIds=new Set(); for (const prediction of predictions) { const parsed=predictionCaseSchema.parse(prediction); if(!corpusIds.has(parsed.caseId)) throw new Error(`prediction has no corpus case: ${parsed.caseId}`); if(predictionIds.has(parsed.caseId)) throw new Error(`duplicate prediction: ${parsed.caseId}`); predictionIds.add(parsed.caseId); if(parsed.artifactManifest.capabilityRegistryHash!==registryHash) throw new Error(`prediction registry mismatch: ${parsed.caseId}`); if(parsed.artifactManifest.normalizerVersion!==EVALUATION_NORMALIZER_VERSION || normalizerVersion!==EVALUATION_NORMALIZER_VERSION) throw new Error(`prediction normalizer mismatch: ${parsed.caseId}`); }
  const slices=[...new Set(corpus.flatMap((item)=>item.slices))].sort(); const results=[];
  const partitionReports=Object.fromEntries(["train","development","shadow","holdout"].map((partition)=>[partition,partitionReport({partition,cases:corpus.filter((item)=>item.partition===partition),predictions,fields,slices,requiredFields,criticalFields})]));
  const holdout=partitionReports.holdout;
  return { evaluationVersion:"invoice-evaluation-v1", normalizerVersion:EVALUATION_NORMALIZER_VERSION, registryHash, slices, partitionReports, fieldResults:holdout.fieldResults, documentResult:holdout.documentResult };
}
