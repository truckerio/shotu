import assert from "node:assert/strict";
import test from "node:test";
import { deterministicallyReconciles, evaluateRun, simultaneousAdjustedWilsonBounds, wilsonInterval } from "./invoice-evaluation.metrics.js";
import { evaluateRelease } from "./invoice-evaluation.release.js";
import { EVALUATION_NORMALIZER_VERSION, validateCorpus } from "./invoice-evaluation.contract.js";

const hash="registry-v1";
const field=(value, applicable=true)=>({applicable,value});
const draftField=(value,confidence=99)=>({value,confidence});
function corpusCase(id,{slice="digital",total=10,synthetic=false,partition="holdout",lineage=id}={}) { return {caseId:id,lineageGroupId:lineage,partition,family:"supplier_invoice",slices:[slice],source:{modality:"pdf",synthetic},labels:{status:"resolved",guideVersion:"guide-v1",truthDraft:{documentType:field("invoice"),vendorName:field("Fleet Pride"),vendorAccount:field(null,false),invoiceNumber:field(`INV-${id}`),invoiceDate:field("2026-08-29"),purchaseOrderNumber:field(null,false),currency:field("USD"),subtotal:field(total),tax:field(0),shipping:field(0),total:field(total),lines:[{id:"row-1",partNumber:field("ABC-1"),description:field("Part"),quantity:field(1),unitOfMeasure:field("EA"),unitPrice:field(total),lineTotal:field(total)}]}},artifactManifest:{capabilityRegistryHash:hash,normalizerVersion:EVALUATION_NORMALIZER_VERSION} }; }
function prediction(id,{total=10,accepted=false,lines=1}={}) { return {caseId:id,draft:{documentType:draftField("invoice"),vendorName:draftField("fleet pride"),vendorAccount:draftField(null),invoiceNumber:draftField(`INV-${id}`),invoiceDate:draftField("2026-08-29"),purchaseOrderNumber:draftField(null),currency:draftField("usd"),subtotal:draftField(total),tax:draftField(0),shipping:draftField(0),total:draftField(total),lines:Array.from({length:lines},(_,i)=>({id:`p-${i}`,partNumber:draftField("abc1"),description:draftField("part"),quantity:draftField(1),unitOfMeasure:draftField("ea"),unitPrice:draftField(total),lineTotal:draftField(total)})),warnings:[]},decision:{outcome:accepted?"accepted_draft":"needs_review",accepted},artifactManifest:{capabilityRegistryHash:hash,normalizerVersion:EVALUATION_NORMALIZER_VERSION} }; }

test("counts eligible, returned, correct, abstained, missing truth, and false accepts without denominator hiding", () => {
  const corpus=[corpusCase("a"),corpusCase("b"),corpusCase("c")];
  corpus[1].labels.truthDraft.total=field(null); corpus[2].labels.truthDraft.total=field(20);
  const predictions=[prediction("a",{accepted:true}),prediction("b",{total:0}),prediction("c",{total:10,accepted:true})];
  const report=evaluateRun({registryHash:hash,corpus,predictions,fields:["total"],requiredFields:["total"],criticalFields:["total"]}); const result=report.fieldResults[0];
  assert.deepEqual({eligible:result.eligible,returned:result.returned,correct:result.correct,abstained:result.abstained,wrong:result.wrongReturned,falseAccepts:result.falseAccepts},{eligible:3,returned:3,correct:1,abstained:0,wrong:2,falseAccepts:1});
  assert.equal(result.coverage,1); assert.equal(result.endToEndSuccess,1/3); assert.equal(result.presence.precision,2/3);
});

test("typed normalizers preserve zero, normalize part numbers/currency, and reject a decimal shift", () => {
  const item=corpusCase("typed",{total:0}); const p=prediction("typed",{total:0}); p.draft.lines[0].partNumber.value="ABC-1"; p.draft.currency.value="usd";
  let report=evaluateRun({registryHash:hash,corpus:[item],predictions:[p],fields:["total","partNumber","currency"]}); assert.equal(report.fieldResults.every((r)=>r.correct===1),true);
  p.draft.total.value=0.1; report=evaluateRun({registryHash:hash,corpus:[item],predictions:[p],fields:["total"]}); assert.equal(report.fieldResults[0].correct,0);
});

test("Wilson is bounded and simultaneous adjustment is deterministic and stricter with multiple hypotheses", () => {
  assert.equal(wilsonInterval(0,0),null); const interval=wilsonInterval(95,100); assert.ok(interval.lower<.95&&interval.upper>.95);
  const first=simultaneousAdjustedWilsonBounds([{key:"b",correct:100,total:100},{key:"a",correct:100,total:100}]); const second=simultaneousAdjustedWilsonBounds([{key:"a",correct:100,total:100},{key:"b",correct:100,total:100}]);
  assert.deepEqual(first,second); assert.ok(first.a.interval.lower < wilsonInterval(100,100).lower);
});

test("evaluation rejects duplicate or orphan predictions instead of silently selecting a retry", () => {
  const item=corpusCase("only"); const p=prediction("only");
  assert.throws(()=>evaluateRun({registryHash:hash,corpus:[item],predictions:[p,p],fields:["total"]}),/duplicate prediction/);
  assert.throws(()=>evaluateRun({registryHash:hash,corpus:[item],predictions:[prediction("orphan")],fields:["total"]}),/no corpus case/);
});

test("corpus validation rejects duplicate IDs, cross-partition lineage, unresolved labels, holdout-seeded synthetic, and registry drift", () => {
  const base=corpusCase("one"); assert.throws(()=>validateCorpus({registryHash:hash,corpus:[base,{...base,caseId:"two",partition:"train"}]}),/lineage crosses/);
  assert.throws(()=>validateCorpus({registryHash:hash,corpus:[{...base,labels:{...base.labels,status:"unresolved"}}]}),/unresolved/);
  assert.throws(()=>validateCorpus({registryHash:hash,corpus:[{...base,source:{...base.source,synthetic:true,seedPartition:"holdout"}}]}),/holdout-seeded/);
  assert.throws(()=>validateCorpus({registryHash:hash,corpus:[{...base,artifactManifest:{...base.artifactManifest,capabilityRegistryHash:"wrong"}}]}),/registry mismatch/);
  assert.throws(()=>validateCorpus({registryHash:hash,corpus:[base,{...base,caseId:"retry"}]}),/duplicate lineage/);
});

test("accepted document correctness requires deterministic arithmetic, not merely no warning text", () => {
  const p=prediction("math",{accepted:true}); assert.equal(deterministicallyReconciles(p.draft),true);
  p.draft.lines[0].lineTotal.value=9.9; assert.equal(deterministicallyReconciles(p.draft),false);
  p.draft.lines[0].lineTotal.value=10; p.draft.warnings=["unreconciled"]; assert.equal(deterministicallyReconciles(p.draft),false);
});

test("all-line document correctness rejects extra, missing, and wrong rows even if scalar aggregate passes", () => {
  const item=corpusCase("rows"); const exact=prediction("rows",{lines:1}); const extra=prediction("rows",{lines:2});
  const exactReport=evaluateRun({registryHash:hash,corpus:[item],predictions:[exact],fields:["total"]}); const extraReport=evaluateRun({registryHash:hash,corpus:[item],predictions:[extra],fields:["total"]});
  assert.equal(exactReport.documentResult.correct,1); assert.equal(extraReport.documentResult.correct,0); assert.equal(extraReport.fieldResults[0].correct,1);
});

test("release gate fails a single weak slice despite a strong aggregate and enforces strict false-accept boundary", () => {
  const rows=Array.from({length:300},(_,index)=>corpusCase(`good-${index}`,{slice:"good"})); const bad=corpusCase("bad",{slice:"bad",total:10}); const predictions=[...rows.map((item)=>prediction(item.caseId)),prediction("bad",{total:20,accepted:true})];
  const report=evaluateRun({registryHash:hash,corpus:[...rows,bad],predictions,fields:["total"],requiredFields:["total"],criticalFields:["total"]});
  const release=evaluateRelease({partitionReports:report.partitionReports,gates:{minimumOccurrences:1,lowerBound:0,criticalPoint:0,noncriticalPoint:0,requiredCoverage:0,documentExact:0}});
  assert.equal(release.released,false); assert.ok(release.failures.some((item)=>item.startsWith("total/bad: false accepts")));
});

test("release only reads sealed holdout reports, so inflated train scores cannot rescue a failed holdout", () => {
  const train=Array.from({length:300},(_,i)=>corpusCase(`train-${i}`,{partition:"train",slice:"shared"})); const holdout=corpusCase("holdout-bad",{partition:"holdout",slice:"shared"});
  const predictions=[...train.map((item)=>prediction(item.caseId)),prediction("holdout-bad",{total:20})];
  const report=evaluateRun({registryHash:hash,corpus:[...train,holdout],predictions,fields:["total"],requiredFields:["total"],criticalFields:["total"]});
  assert.equal(report.partitionReports.train.fieldResults[0].correct,300); assert.equal(report.fieldResults[0].correct,0);
  const release=evaluateRelease({partitionReports:report.partitionReports,gates:{minimumOccurrences:1,lowerBound:0,criticalPoint:.98,noncriticalPoint:0,requiredCoverage:0,documentExact:0,documentFalseAcceptRate:1}});
  assert.equal(release.released,false); assert.ok(release.failures.some((failure)=>failure.startsWith("total/shared: point accuracy")));
  assert.throws(()=>evaluateRelease({partitionReports:{holdout:report.partitionReports.train}}),/sealed holdout/);
});

test("a wrong accepted document blocks release even when the wrong field confidence is below 90", () => {
  const item=corpusCase("accepted-wrong"); const p=prediction("accepted-wrong",{total:20,accepted:true}); p.draft.total.confidence=89;
  const report=evaluateRun({registryHash:hash,corpus:[item],predictions:[p],fields:["total"],requiredFields:["total"],criticalFields:["total"]});
  assert.equal(report.fieldResults[0].falseAccepts,0); assert.equal(report.documentResult.falseAccepts,1);
  const release=evaluateRelease({partitionReports:report.partitionReports,gates:{minimumOccurrences:1,lowerBound:0,criticalPoint:0,noncriticalPoint:0,requiredCoverage:0,documentExact:0,documentFalseAcceptRate:.001}});
  assert.equal(release.released,false); assert.ok(release.failures.includes("documents: false accepts"));
});

test("registry and sealed built-in normalizer drift fail closed and callers cannot loosen tolerances", () => {
  const item=corpusCase("drift"); const p=prediction("drift");
  assert.throws(()=>evaluateRun({registryHash:hash,normalizerVersion:"loose-v2",corpus:[item],predictions:[p],fields:["total"]}),/normalizer mismatch/);
  assert.throws(()=>evaluateRun({registryHash:hash,corpus:[{...item,artifactManifest:{...item.artifactManifest,normalizerVersion:"loose-v2"}}],predictions:[p],fields:["total"]}),/normalizer mismatch/);
  p.draft.total.value=10.01; assert.equal(evaluateRun({registryHash:hash,corpus:[item],predictions:[p],fields:["total"]}).fieldResults[0].correct,0);
});
