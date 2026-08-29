import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const planUrl = new URL("../../docs/INVOICE_EXTRACTION_GLOBAL_ACCURACY_PLAN.md", import.meta.url);
const plan = await readFile(planUrl, "utf8");

const contracts = [
  {
    name: "truth boundary and safe abstention",
    patterns: [
      /accuracy is not yet proven/i,
      /unsupported/i,
      /safely abstain/i,
      /not an honest or testable product claim/i,
      /versioned document family/i,
    ],
  },
  {
    name: "per-field statistical release gate",
    patterns: [
      /per field and per document-family slice/i,
      /Wilson lower bound of the 95% confidence interval is at least 95%/i,
      /Required-field coverage is at least 95%/i,
      /False-accept rate.*below 0\.1%/i,
      /Document-level all-critical-fields exact match/i,
      /selective risk/i,
      /accuracy_when_returned = correct \/ returned/i,
      /coverage = returned \/ eligible/i,
      /end_to_end_success = correct \/ eligible/i,
      /Holm-Bonferroni correction/i,
    ],
  },
  {
    name: "anti-leakage evaluation",
    patterns: [
      /group-disjoint by company, vendor identity, layout\/template family, source system, capture device, and time window/i,
      /final untouched holdout/i,
      /zero-shot/i,
      /few-shot/i,
      /Synthetic documents.*never serve as the sole evidence/is,
      /seal the supported-capability registry and slice taxonomy with a content hash/i,
      /cannot be removed, merged, renamed, or declared “unsupported” after its results are known/i,
      /near-duplicate audit groups originals, rescans, exports, revisions, crops, screenshots, OCR-equivalent pages, and synthetic derivatives/i,
      /entire duplicate\/derivative group belongs to one partition/i,
      /Synthetic generators may not seed from final-holdout content/i,
    ],
  },
  {
    name: "label quality and honest benchmark claims",
    patterns: [
      /two independent labels for critical fields/i,
      /blinded adjudication/i,
      /inter-annotator agreement/i,
      /identical task\/schema\/split\/metric/i,
      /statistically significant result/i,
      /Never compare vendor marketing percentages/i,
    ],
  },
  {
    name: "external benchmark coverage",
    patterns: [
      /https:\/\/arxiv\.org\/abs\/2302\.05658/,
      /https:\/\/arxiv\.org\/abs\/2103\.10213/,
      /https:\/\/arxiv\.org\/abs\/1905\.13538/,
      /https:\/\/arxiv\.org\/abs\/2007\.00398/,
    ],
  },
  {
    name: "privacy-safe global structure",
    patterns: [
      /Only geometry and coarse structure may cross tenant boundaries/i,
      /HMAC-SHA-256/i,
      /INVOICE_LAYOUT_HMAC_KEY/,
      /Plain SHA-256.*prohibited/is,
      /raw OCR text/i,
      /Default is off/i,
      /Consent withdrawal tombstones the contribution/i,
      /canonical serializer and entropy\/cardinality scanner/i,
      /Geometry is canonicalized and quantized/i,
    ],
  },
  {
    name: "promotion and poisoning resistance",
    patterns: [
      /at least 5 independently reviewed documents from at least 3 companies/i,
      /no company supplying more than 40%/i,
      /Contributions are rate-limited and capped per company\/layout/i,
      /automatically quarantines/i,
      /signed\/versioned artifacts/i,
      /deterministically rebuilds affected aggregate\/global artifacts/i,
    ],
  },
  {
    name: "secure file processing",
    patterns: [
      /detect MIME from magic bytes/i,
      /actual decompressed-byte limits/i,
      /sandboxed worker with CPU, memory, time, page, and recursion limits/i,
      /decompression bombs/i,
      /provider storage disabled/i,
      /no confidential values in logs/i,
      /per-tenant rate limits/i,
    ],
  },
  {
    name: "remote provider governance",
    patterns: [
      /optional, tenant-policy-controlled processor/i,
      /DPA\/subprocessor/i,
      /no-training and zero-retention commitments/i,
      /per-tenant opt-in/i,
      /regional egress allowlists/i,
      /dedicated secret isolation/i,
      /immediate provider kill switch/i,
      /falls back to local extraction plus review/i,
    ],
  },
  {
    name: "model and output attack handling",
    patterns: [
      /white-on-white\/hidden text/i,
      /QR codes, barcodes/i,
      /Unicode confusables/i,
      /model output is schema-validated and cannot invoke tools/i,
      /SQL fragments, formula injection, HTML\/JavaScript, path traversal/i,
    ],
  },
  {
    name: "financial and line-item semantics",
    patterns: [
      /paid balance of zero is distinct from invoice total/i,
      /negative credits remain negative/i,
      /quantity × unit price/i,
      /line sum/i,
      /table continuation/i,
      /line-item recognition\/grouping micro-F1/i,
    ],
  },
  {
    name: "safe rollout and rollback",
    patterns: [
      /shadow state, then canary, then active/i,
      /automatic rollback/i,
      /instant rollback/i,
      /quarantine/i,
      /drift/i,
      /complete compatible manifest/i,
      /Unknown or incompatible versions fail closed to review/i,
    ],
  },
  {
    name: "explicit accountable ownership",
    patterns: [
      /Data owners approve corpus authority and retention/i,
      /Security owns intake isolation/i,
      /Invoice Extraction module owns schemas/i,
      /QA owns sealed manifests/i,
      /Operations owns reviewer workflow/i,
      /No owner may approve its own failed gate away/i,
    ],
  },
  {
    name: "implementation artifact backlog",
    patterns: [
      /invoice_extraction_capability_registry/,
      /invoice_extraction_corpus_manifest/,
      /invoice_extraction_annotations/,
      /invoice_extraction_evaluation_runs/,
      /canonical sanitizer/i,
      /calibrated decision API/i,
      /full-compatible-manifest rollback drill/i,
    ],
  },
];

function validatePlan(text) {
  const failures = [];

  for (const contract of contracts) {
    const missing = contract.patterns.filter((pattern) => !pattern.test(text));
    if (missing.length) {
      failures.push(`${contract.name}: missing ${missing.map(String).join(", ")}`);
    }
  }

  const requiredFields = [
    "documentType",
    "vendorName",
    "vendorAccount",
    "invoiceNumber",
    "invoiceDate",
    "purchaseOrderNumber",
    "currency",
    "subtotal",
    "tax",
    "shipping",
    "total",
    "partNumber",
    "description",
    "quantity",
    "unitPrice",
    "lineTotal",
  ];
  const missingFields = requiredFields.filter((field) => !text.includes(`\`${field}\``));
  if (missingFields.length) failures.push(`field contract: missing ${missingFields.join(", ")}`);

  const adversarialTerms = [
    "rotation",
    "perspective",
    "blur",
    "compression",
    "handwriting",
    "multi-page",
    "page-split tables",
    "negative",
    "multiple currencies",
    "prompt injection",
    "Unicode confusables",
    "polyglot",
    "decompression-bomb",
  ];
  const adversarialCoverage = adversarialTerms.filter((term) => text.toLowerCase().includes(term.toLowerCase()));
  if (adversarialCoverage.length < 12) {
    failures.push(`adversarial matrix: only ${adversarialCoverage.length}/${adversarialTerms.length} categories`);
  }

  const forbiddenPolicies = [
    /(?:guarantee(?:s|d)? (?:support for|extraction from) (?:any|every) document|extraction from (?:any|every) document is guaranteed)/i,
    /global(?:ize|ized|ization)? raw OCR/i,
    /plain SHA-256 of labels is allowed/i,
    /trust (?:the )?filename(?: extension)? for (?:file type|MIME)/i,
    /remote provider processing is default-on/i,
    /send(?:s|ing)? unsupported documents to another provider/i,
    /synthetic data alone (?:proves|establishes) production accuracy/i,
    /remove failing slices after (?:evaluation|review)/i,
  ];
  const contradictions = forbiddenPolicies.filter((pattern) => pattern.test(text));
  if (contradictions.length) {
    failures.push(`forbidden policy contradiction: ${contradictions.map(String).join(", ")}`);
  }

  return failures;
}

test("living plan satisfies extraction accuracy, privacy, and security contracts", () => {
  assert.deepEqual(validatePlan(plan), []);
});

test("checker catches an inflated universal-support claim with no abstention contract", () => {
  const mutated = plan
    .replaceAll("safely abstain", "always extract")
    .replace("not an honest or testable product claim", "a guaranteed product claim");
  assert.ok(validatePlan(mutated).some((failure) => failure.startsWith("truth boundary")));
});

test("checker catches a dictionary-reversible global marker design", () => {
  const mutated = plan
    .replaceAll("HMAC-SHA-256", "SHA-256")
    .replace("Plain SHA-256 of labels is prohibited", "Plain SHA-256 of labels is allowed");
  assert.ok(validatePlan(mutated).some((failure) => failure.startsWith("privacy-safe global structure")));
});

test("checker catches removal of group-disjoint holdout protection", () => {
  const mutated = plan.replace(
    "group-disjoint by company, vendor identity, layout/template family, source system, capture device, and time window",
    "random by page",
  );
  assert.ok(validatePlan(mutated).some((failure) => failure.startsWith("anti-leakage evaluation")));
});

test("checker catches missing false-accept and coverage gates", () => {
  const mutated = plan
    .replace("Required-field coverage is at least 95%", "Coverage is reported")
    .replace("False-accept rate for confidently wrong critical values is below 0.1%", "False accepts are reviewed");
  assert.ok(validatePlan(mutated).some((failure) => failure.startsWith("per-field statistical release gate")));
});

test("checker catches weakened parser isolation", () => {
  const mutated = plan
    .replace("detect MIME from magic bytes", "trust the filename")
    .replace("sandboxed worker with CPU, memory, time, page, and recursion limits", "shared application process");
  assert.ok(validatePlan(mutated).some((failure) => failure.startsWith("secure file processing")));
});

test("checker catches post-hoc slice selection", () => {
  const mutated = plan
    .replace("seal the supported-capability registry and slice taxonomy with a content hash", "list useful slices")
    .replace("cannot be removed, merged, renamed, or declared “unsupported” after its results are known", "can be adjusted after review");
  assert.ok(validatePlan(mutated).some((failure) => failure.startsWith("anti-leakage evaluation")));
});

test("checker catches weak or model-influenced ground truth", () => {
  const mutated = plan
    .replace("two independent labels for critical fields", "one label for critical fields")
    .replaceAll("blinded adjudication", "model-assisted adjudication");
  assert.ok(validatePlan(mutated).some((failure) => failure.startsWith("label quality")));
});

test("checker catches structural covert-channel regression", () => {
  const mutated = plan
    .replace("Geometry is canonicalized and quantized", "Geometry retains exact source precision")
    .replace("canonical serializer and entropy/cardinality scanner", "generic JSON serializer");
  assert.ok(validatePlan(mutated).some((failure) => failure.startsWith("privacy-safe global structure")));
});

test("checker catches revocation without deterministic rebuild", () => {
  const mutated = plan.replace(
    "deterministically rebuilds affected aggregate/global artifacts",
    "leaves existing aggregate/global artifacts unchanged",
  );
  assert.ok(validatePlan(mutated).some((failure) => failure.startsWith("promotion and poisoning resistance")));
});

test("checker catches partial artifact rollback", () => {
  const mutated = plan
    .replace("Unknown or incompatible versions fail closed to review", "Unknown versions use the newest model")
    .replace("complete compatible manifest", "model file only");
  assert.ok(validatePlan(mutated).some((failure) => failure.startsWith("safe rollout and rollback")));
});

test("checker catches statistical denominator or multiplicity gaming", () => {
  const mutated = plan
    .replace("accuracy_when_returned = correct / returned", "accuracy = selected wins / selected examples")
    .replace("Holm-Bonferroni correction", "uncorrected intervals");
  assert.ok(validatePlan(mutated).some((failure) => failure.startsWith("per-field statistical release gate")));
});

test("checker catches derivative leakage across partitions", () => {
  const mutated = plan
    .replace("entire duplicate/derivative group belongs to one partition", "duplicate pages may be randomly split")
    .replace("Synthetic generators may not seed from final-holdout content", "Synthetic generators may use any seed");
  assert.ok(validatePlan(mutated).some((failure) => failure.startsWith("anti-leakage evaluation")));
});

test("checker catches uncontrolled remote-provider processing", () => {
  const mutated = plan
    .replace("per-tenant opt-in", "global default-on processing")
    .replace("immediate provider kill switch", "manual provider review")
    .replace("no-training and zero-retention commitments", "standard provider terms");
  assert.ok(validatePlan(mutated).some((failure) => failure.startsWith("remote provider governance")));
});

test("checker catches unsafe contradictions even when secure requirements remain", () => {
  const mutated = `${plan}\n\nOperational exceptions: remote provider processing is default-on. Globalize raw OCR for debugging.`;
  assert.ok(validatePlan(mutated).some((failure) => failure.startsWith("forbidden policy contradiction")));
});

test("checker catches universal accuracy guarantees appended to an otherwise valid plan", () => {
  const mutated = `${plan}\n\nMarketing guarantee: extraction from every document is guaranteed.`;
  assert.ok(validatePlan(mutated).some((failure) => failure.startsWith("forbidden policy contradiction")));
});
